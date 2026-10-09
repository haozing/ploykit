package contractx

import (
	"errors"
	"fmt"
	"slices"
	"sort"
	"strings"
)

type DiffKind string

const (
	DiffMissing DiffKind = "missing"

	DiffDuplicate DiffKind = "duplicate"

	DiffMethodMismatch DiffKind = "method-mismatch"

	DiffParamNameMismatch DiffKind = "param-name-mismatch"

	DiffOperationIDMismatch DiffKind = "operation-id-mismatch"
)

type Diff struct {
	Kind         DiffKind          `json:"kind"`
	Method       string            `json:"method,omitempty"`
	Path         string            `json:"path"`
	PresentIn    []string          `json:"present_in,omitempty"`
	MissingIn    []string          `json:"missing_in,omitempty"`
	Sides        []string          `json:"sides,omitempty"`
	Methods      map[string]string `json:"methods,omitempty"`
	Paths        map[string]string `json:"paths,omitempty"`
	OperationIDs map[string]string `json:"operation_ids,omitempty"`
	Detail       string            `json:"detail"`
}

type Report struct {
	Sides []string `json:"sides"`
	Diffs []Diff   `json:"diffs,omitempty"`
}

func (r Report) Empty() bool {
	return len(r.Diffs) == 0
}

func (r Report) String() string {
	if r.Empty() {
		return fmt.Sprintf("OK: %d side(s) agree with zero drift", len(r.Sides))
	}
	var b strings.Builder
	fmt.Fprintf(&b, "FAIL: %d drift(s) across %d side(s)", len(r.Diffs), len(r.Sides))
	for _, diff := range r.Diffs {
		b.WriteString("\n  ")
		b.WriteString(diff.Detail)
	}
	return b.String()
}

type routeKey struct {
	method string
	path   string
}

func Compare(sides ...Side) (Report, error) {
	if len(sides) < 2 {
		return Report{}, errors.New("contractx: compare needs at least two sides")
	}
	names := make([]string, len(sides))
	seen := make(map[string]struct{}, len(sides))
	for i, side := range sides {
		name := strings.TrimSpace(side.Name)
		if name == "" {
			return Report{}, fmt.Errorf("contractx: side %d has a blank name", i)
		}
		if _, dup := seen[name]; dup {
			return Report{}, fmt.Errorf("contractx: duplicate side name %q", name)
		}
		seen[name] = struct{}{}
		names[i] = name
	}

	var diffs []Diff

	tables := make([]map[routeKey]RouteSpec, len(sides))
	byPath := make([]map[string][]RouteSpec, len(sides))
	bySkeleton := make([]map[string][]RouteSpec, len(sides))
	for i, side := range sides {
		table := make(map[routeKey]RouteSpec, len(side.Routes))
		paths := make(map[string][]RouteSpec)
		skeletons := make(map[string][]RouteSpec)
		for _, route := range side.Routes {
			normalized := NewRouteSpec(route.Method, route.Path, route.OperationID)
			if normalized.Method == "" || normalized.Path == "" {
				return Report{}, fmt.Errorf("contractx: side %q has a route with blank method or path", names[i])
			}
			key := routeKey{normalized.Method, normalized.Path}
			if existing, dup := table[key]; dup {
				diffs = append(diffs, Diff{
					Kind:   DiffDuplicate,
					Method: normalized.Method,
					Path:   normalized.Path,
					Sides:  []string{names[i]},
					Detail: fmt.Sprintf("duplicate: %s %s declared more than once in %q (%s, %s)",
						normalized.Method, normalized.Path, names[i], opLabel(existing), opLabel(normalized)),
				})
				continue
			}
			table[key] = normalized
			paths[normalized.Path] = append(paths[normalized.Path], normalized)
			skeletonKey := skeletonIndexKey(normalized.Method, normalized.Path)
			skeletons[skeletonKey] = append(skeletons[skeletonKey], normalized)
		}
		tables[i] = table
		byPath[i] = paths
		bySkeleton[i] = skeletons
	}

	union := make(map[routeKey][]int)
	for i, table := range tables {
		for key := range table {
			union[key] = append(union[key], i)
		}
	}
	keys := make([]routeKey, 0, len(union))
	for key := range union {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(a, b int) bool {
		if keys[a].path != keys[b].path {
			return keys[a].path < keys[b].path
		}
		return keys[a].method < keys[b].method
	})

	emittedMethod := make(map[string]bool)
	emittedParam := make(map[string]bool)
	for _, key := range keys {
		present := union[key]
		if len(present) == len(sides) {
			if diff, ok := operationIDDiff(names, tables, key, present); ok {
				diffs = append(diffs, diff)
			}
			continue
		}
		missing := missingSides(present, len(sides))
		var methodSides, paramSides, plainSides []int
		skeletonKey := skeletonIndexKey(key.method, key.path)
		for _, i := range missing {
			switch {
			case len(byPath[i][key.path]) > 0:
				methodSides = append(methodSides, i)
			case len(bySkeleton[i][skeletonKey]) > 0:
				paramSides = append(paramSides, i)
			default:
				plainSides = append(plainSides, i)
			}
		}
		if len(methodSides) > 0 && !emittedMethod[key.path] {
			emittedMethod[key.path] = true
			diffs = append(diffs, methodMismatchDiff(names, byPath, key.path))
		}
		if len(paramSides) > 0 && !emittedParam[skeletonKey] {
			emittedParam[skeletonKey] = true
			diffs = append(diffs, paramMismatchDiff(names, bySkeleton, key))
		}
		if len(plainSides) > 0 {
			diffs = append(diffs, Diff{
				Kind:      DiffMissing,
				Method:    key.method,
				Path:      key.path,
				PresentIn: sideNames(names, present),
				MissingIn: sideNames(names, plainSides),
				Detail: fmt.Sprintf("missing: %s %s present in [%s], missing in [%s]",
					key.method, key.path,
					strings.Join(sideNames(names, present), ", "),
					strings.Join(sideNames(names, plainSides), ", ")),
			})
		}
	}

	sort.Slice(diffs, func(a, b int) bool {
		if diffs[a].Kind != diffs[b].Kind {
			return diffs[a].Kind < diffs[b].Kind
		}
		if diffs[a].Path != diffs[b].Path {
			return diffs[a].Path < diffs[b].Path
		}
		if diffs[a].Method != diffs[b].Method {
			return diffs[a].Method < diffs[b].Method
		}
		return diffs[a].Detail < diffs[b].Detail
	})
	return Report{Sides: names, Diffs: diffs}, nil
}

func operationIDDiff(names []string, tables []map[routeKey]RouteSpec, key routeKey, present []int) (Diff, bool) {
	ids := make(map[string]string, len(present))
	for _, i := range present {
		route := tables[i][key]
		if route.OperationID != "" {
			ids[names[i]] = route.OperationID
		}
	}
	if len(ids) < 2 {
		return Diff{}, false
	}
	distinct := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		distinct[id] = struct{}{}
	}
	if len(distinct) < 2 {
		return Diff{}, false
	}
	pairs := make([]string, 0, len(ids))
	for _, name := range names {
		if id, ok := ids[name]; ok {
			pairs = append(pairs, fmt.Sprintf("%s=%s", name, id))
		}
	}
	return Diff{
		Kind:         DiffOperationIDMismatch,
		Method:       key.method,
		Path:         key.path,
		OperationIDs: ids,
		Detail: fmt.Sprintf("operation-id-mismatch: %s %s %s",
			key.method, key.path, strings.Join(pairs, " ")),
	}, true
}

func methodMismatchDiff(names []string, byPath []map[string][]RouteSpec, path string) Diff {
	methods := make(map[string]string, len(names))
	for i, name := range names {
		routes := byPath[i][path]
		if len(routes) == 0 {
			continue
		}
		methodList := make([]string, 0, len(routes))
		for _, route := range routes {
			methodList = append(methodList, route.Method)
		}
		sort.Strings(methodList)
		methods[name] = strings.Join(methodList, ",")
	}
	pairs := make([]string, 0, len(methods))
	for _, name := range names {
		if method, ok := methods[name]; ok {
			pairs = append(pairs, fmt.Sprintf("%s=%s", name, method))
		}
	}
	return Diff{
		Kind:    DiffMethodMismatch,
		Path:    path,
		Methods: methods,
		Detail:  fmt.Sprintf("method-mismatch: %s carries different methods (%s)", path, strings.Join(pairs, " ")),
	}
}

func paramMismatchDiff(names []string, bySkeleton []map[string][]RouteSpec, key routeKey) Diff {
	skeletonKey := skeletonIndexKey(key.method, key.path)
	paths := make(map[string]string, len(names))
	for i, name := range names {
		routes := bySkeleton[i][skeletonKey]
		if len(routes) == 0 {
			continue
		}
		literals := make([]string, 0, len(routes))
		for _, route := range routes {
			literals = append(literals, route.Path)
		}
		sort.Strings(literals)
		paths[name] = strings.Join(literals, ",")
	}
	pairs := make([]string, 0, len(paths))
	for _, name := range names {
		if literal, ok := paths[name]; ok {
			pairs = append(pairs, fmt.Sprintf("%s=%s", name, literal))
		}
	}
	return Diff{
		Kind:   DiffParamNameMismatch,
		Method: key.method,
		Path:   pathSkeleton(key.path),
		Paths:  paths,
		Detail: fmt.Sprintf("param-name-mismatch: %s %s spelled differently across sides (%s)",
			key.method, pathSkeleton(key.path), strings.Join(pairs, " ")),
	}
}

func pathSkeleton(path string) string {
	var b strings.Builder
	for i := 0; i < len(path); {
		if path[i] == '{' {
			end := strings.IndexByte(path[i:], '}')
			if end < 0 {
				b.WriteString(path[i:])
				break
			}
			b.WriteString("{}")
			i += end + 1
			continue
		}
		b.WriteByte(path[i])
		i++
	}
	return b.String()
}

func skeletonIndexKey(method, path string) string {
	return method + " " + pathSkeleton(path)
}

func missingSides(present []int, total int) []int {
	missing := make([]int, 0, total-len(present))
	for i := range total {
		if !slices.Contains(present, i) {
			missing = append(missing, i)
		}
	}
	return missing
}

func sideNames(names []string, indices []int) []string {
	out := make([]string, 0, len(indices))
	for _, i := range indices {
		out = append(out, names[i])
	}
	return out
}

func opLabel(route RouteSpec) string {
	if route.OperationID == "" {
		return "-"
	}
	return route.OperationID
}
