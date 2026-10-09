package contractx

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	yaml "go.yaml.in/yaml/v3"
)

var openapiMethodKeys = map[string]struct{}{
	"get":     {},
	"post":    {},
	"put":     {},
	"patch":   {},
	"delete":  {},
	"head":    {},
	"options": {},
	"trace":   {},
}

func ParseOpenAPIRoutes(data []byte) ([]RouteSpec, error) {
	document, err := decodeDocument(data)
	if err != nil {
		return nil, fmt.Errorf("contractx: decode openapi document: %w", err)
	}
	rawPaths, ok := document["paths"]
	if !ok {
		return nil, errors.New("contractx: openapi document has no paths object")
	}
	paths, ok := rawPaths.(map[string]any)
	if !ok {
		return nil, errors.New("contractx: openapi paths is not an object")
	}
	var routes []RouteSpec
	for path, item := range paths {
		if !strings.HasPrefix(path, "/") {
			return nil, fmt.Errorf("contractx: openapi path %q does not start with '/'", path)
		}
		if item == nil {
			continue
		}
		itemMap, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("contractx: openapi path %q is not an object", path)
		}
		for key, operation := range itemMap {
			if _, isMethod := openapiMethodKeys[key]; !isMethod {
				continue
			}
			spec := RouteSpec{Method: strings.ToUpper(key), Path: path}
			if operationMap, ok := operation.(map[string]any); ok {
				if id, ok := operationMap["operationId"].(string); ok {
					spec.OperationID = strings.TrimSpace(id)
				}
			}
			routes = append(routes, spec)
		}
	}
	sort.Slice(routes, func(i, j int) bool {
		if routes[i].Path != routes[j].Path {
			return routes[i].Path < routes[j].Path
		}
		return routes[i].Method < routes[j].Method
	})
	return routes, nil
}

func decodeDocument(data []byte) (map[string]any, error) {
	if trimmed := bytes.TrimLeft(data, " \t\r\n"); len(trimmed) > 0 && trimmed[0] == '{' {
		var document map[string]any
		if err := json.Unmarshal(data, &document); err == nil {
			return document, nil
		}

	}
	var document map[string]any
	if err := yaml.Unmarshal(data, &document); err != nil {
		return nil, err
	}
	return document, nil
}
