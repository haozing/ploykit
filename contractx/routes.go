package contractx

import (
	"fmt"
	"strings"
)

const (
	AttrTransport = "transport"

	AttrHTTPMethod = "http_method"

	AttrPath = "path"
)

type RouteSpec struct {
	Method      string `json:"method"`
	Path        string `json:"path"`
	OperationID string `json:"operation_id,omitempty"`
}

func NewRouteSpec(method, path, operationID string) RouteSpec {
	return RouteSpec{
		Method:      strings.ToUpper(strings.TrimSpace(method)),
		Path:        strings.TrimSpace(path),
		OperationID: strings.TrimSpace(operationID),
	}
}

type Side struct {
	Name   string
	Routes []RouteSpec
}

func NewSide(name string, routes []RouteSpec) Side {
	normalized := make([]RouteSpec, len(routes))
	for i, route := range routes {
		normalized[i] = NewRouteSpec(route.Method, route.Path, route.OperationID)
	}
	return Side{Name: name, Routes: normalized}
}

func EntryRoutes(entries []Entry) ([]RouteSpec, error) {
	var routes []RouteSpec
	for _, entry := range entries {
		id := strings.TrimSpace(entry.ID)
		method, methodState := attributeArity(entry, AttrHTTPMethod)
		path, pathState := attributeArity(entry, AttrPath)
		transport, transportState := attributeArity(entry, AttrTransport)
		if transportState == attrMissing {
			transport, transportState = "http", attrSingle
		}
		if transportState == attrMulti {
			return nil, fmt.Errorf("contractx: entry %q attribute %q must be single-valued", id, AttrTransport)
		}
		if methodState == attrMulti {
			return nil, fmt.Errorf("contractx: entry %q attribute %q must be single-valued", id, AttrHTTPMethod)
		}
		if pathState == attrMulti {
			return nil, fmt.Errorf("contractx: entry %q attribute %q must be single-valued", id, AttrPath)
		}
		if transport != "http" {
			if methodState == attrSingle || pathState == attrSingle {
				return nil, fmt.Errorf("contractx: entry %q declares transport %q but carries route attributes", id, transport)
			}
			continue
		}
		if methodState == attrMissing && pathState == attrMissing {
			continue
		}
		if methodState != attrSingle || pathState != attrSingle {
			if methodState == attrSingle {
				return nil, fmt.Errorf("contractx: entry %q declares %q but is missing %q", id, AttrHTTPMethod, AttrPath)
			}
			return nil, fmt.Errorf("contractx: entry %q declares %q but is missing %q", id, AttrPath, AttrHTTPMethod)
		}
		routes = append(routes, NewRouteSpec(method, path, id))
	}
	return routes, nil
}

type attrArity int

const (
	attrMissing attrArity = iota
	attrSingle
	attrMulti
)

func attributeArity(entry Entry, name string) (string, attrArity) {
	values := entry.Attributes[name]
	switch len(values) {
	case 0:
		return "", attrMissing
	case 1:
		return strings.TrimSpace(values[0]), attrSingle
	default:
		return "", attrMulti
	}
}
