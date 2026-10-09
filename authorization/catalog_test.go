package authorization

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const validCatalogYAML = `
catalog_schema_version: 1
roles:
  workspace: [role_ws_a]
  project: [role_caller, role_manager]
operations:
  - operation_id: op.project.read
    auth_method: session
    scope: project_path
    allowed_project_roles: [role_caller]
    assurance: aal1
    recent_auth: none
    idempotency: none
  - operation_id: op.project.token_read
    auth_method: scoped_token
    scope: project_credential
    allowed_project_roles: [role_manager]
    assurance: none
    recent_auth: none
    idempotency: none
  - operation_id: op.platform.public
    auth_method: unauthenticated
    scope: platform
    assurance: none
    recent_auth: none
    idempotency: none
`

func mustParse(t *testing.T, raw string) Catalog {
	t.Helper()
	catalog, err := ParseCatalog([]byte(raw), NewRegistry())
	if err != nil {
		t.Fatalf("ParseCatalog: %v", err)
	}
	return catalog
}

func assertParseError(t *testing.T, raw, messagePart string) {
	t.Helper()
	_, err := ParseCatalog([]byte(raw), NewRegistry())
	if err == nil {
		t.Fatalf("ParseCatalog succeeded, want error containing %q", messagePart)
	}
	if !strings.Contains(err.Error(), messagePart) {
		t.Fatalf("error = %v, want message containing %q", err, messagePart)
	}
}

func TestCatalogParsesGoldenFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "golden.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := ParseCatalog(raw, NewRegistry())
	if err != nil {
		t.Fatalf("ParseCatalog(golden.yaml): %v", err)
	}
	if got := len(catalog.Operations); got != 7 {
		t.Fatalf("operations = %d, want 7", got)
	}

	if catalog.Operations[0].OperationID != "op.platform.public" {
		t.Fatalf("operations are not normalized to sorted order: %+v", catalog.Operations[0])
	}
	tokenRead, ok := catalog.Operation("op.project.token_read")
	if !ok || tokenRead.Assurance != AssuranceNone || tokenRead.RecentAuth != RecentAuthNone ||
		tokenRead.Idempotency != IdempotencyNone || tokenRead.Rules != nil {
		t.Fatalf("zero-value rules not normalized: %+v", tokenRead)
	}
}

func TestCatalogZeroValueNormalizationHashEquivalence(t *testing.T) {
	omitted := `
catalog_schema_version: 1
roles:
  project: [role_caller]
operations:
  - operation_id: op.project.token_read
    auth_method: scoped_token
    scope: project_credential
    allowed_project_roles: [role_caller]
`
	explicit := `
catalog_schema_version: 1
roles:
  project: [role_caller]
operations:
  - operation_id: op.project.token_read
    auth_method: scoped_token
    scope: project_credential
    allowed_project_roles: [role_caller]
    assurance: none
    recent_auth: none
    idempotency: none
    rules: []
`
	first, err := mustParse(t, omitted).Hash()
	if err != nil {
		t.Fatal(err)
	}
	second, err := mustParse(t, explicit).Hash()
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("zero-value normalization not reflected in hash: omitted=%s explicit=%s", first, second)
	}
}

func TestCatalogHashDeterministicUnderReordering(t *testing.T) {
	catalog := mustParse(t, validCatalogYAML)
	first, err := catalog.Hash()
	if err != nil {
		t.Fatal(err)
	}

	reordered := `
catalog_schema_version: 1
roles:
  workspace: [role_ws_a]
  project: [role_manager, role_caller]
operations:
  - operation_id: op.platform.public
    auth_method: unauthenticated
    scope: platform
    assurance: none
    recent_auth: none
    idempotency: none
  - operation_id: op.project.token_read
    auth_method: scoped_token
    scope: project_credential
    allowed_project_roles: [role_manager]
  - operation_id: op.project.read
    auth_method: session
    scope: project_path
    allowed_project_roles: [role_caller]
    assurance: aal1
    recent_auth: none
    idempotency: none
`
	second, err := mustParse(t, reordered).Hash()
	if err != nil {
		t.Fatal(err)
	}
	if first != second {
		t.Fatalf("hash changed after set reordering: %s vs %s", first, second)
	}

	mutated := strings.Replace(validCatalogYAML, "assurance: aal1", "assurance: aal2", 1)
	third, err := mustParse(t, mutated).Hash()
	if err != nil {
		t.Fatal(err)
	}
	if third == first {
		t.Fatal("hash unchanged after content mutation")
	}
}

func TestCatalogRejectsUnknownFieldAndMultipleDocuments(t *testing.T) {
	assertParseError(t, strings.Replace(validCatalogYAML,
		"catalog_schema_version: 1", "catalog_schema_version: 1\nlegacy_fallback: true", 1),
		"legacy_fallback")
	assertParseError(t, validCatalogYAML+"---\ncatalog_schema_version: 1\n",
		"multiple YAML documents")
	assertParseError(t, strings.Replace(validCatalogYAML,
		"catalog_schema_version: 1", "catalog_schema_version: 2", 1),
		"unsupported")
}

func TestCatalogRejectsDuplicateOperationAndClosedSetViolations(t *testing.T) {
	tests := []struct {
		name    string
		old     string
		new     string
		message string
	}{
		{"duplicate operation id", "operation_id: op.project.read", "operation_id: op.project.token_read", "duplicate operation_id"},
		{"empty operation id", "operation_id: op.project.read", "operation_id: \"\"", "empty name"},
		{"unknown auth method", "auth_method: session", "auth_method: session_or_token", "unknown auth_method"},
		{"unknown scope kind", "scope: project_path", "scope: project", "unknown scope"},
		{"unknown assurance", "assurance: aal1", "assurance: aal3", "unknown assurance"},
		{"unknown recent auth", "recent_auth: none\n    idempotency: none\n  - operation_id: op.project.token_read", "recent_auth: password_300s\n    idempotency: none\n  - operation_id: op.project.token_read", "unknown recent_auth"},
		{"unknown idempotency", "idempotency: none\n  - operation_id: op.project.token_read", "idempotency: sometimes\n  - operation_id: op.project.token_read", "unknown idempotency"},
		{"undeclared role", "allowed_project_roles: [role_caller]", "allowed_project_roles: [role_ghost]", "is not declared in roles.project"},
		{"undeclared workspace role", "allowed_project_roles: [role_caller]", "allowed_project_roles: [role_caller]\n    allowed_workspace_roles: [role_ws_ghost]", "is not declared in roles.workspace"},
		{"duplicate role vocabulary", "project: [role_caller, role_manager]", "project: [role_caller, role_manager, role_caller]", "duplicate role"},
		{"unknown rule reference", "idempotency: none", "idempotency: none\n    rules: [not_registered]", "is not registered"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mutated := strings.Replace(validCatalogYAML, test.old, test.new, 1)
			if mutated == validCatalogYAML {
				t.Fatalf("test mutation %q did not apply", test.old)
			}
			assertParseError(t, mutated, test.message)
		})
	}
}

func TestCatalogRejectsWildcards(t *testing.T) {
	assertParseError(t, strings.Replace(validCatalogYAML,
		"operation_id: op.project.read", "operation_id: op.project.*", 1), "wildcard")
	assertParseError(t, strings.Replace(validCatalogYAML,
		"project: [role_caller, role_manager]", "project: [\"project:*\", role_manager]", 1), "wildcard")
	assertParseError(t, strings.Replace(validCatalogYAML,
		"idempotency: none", "idempotency: none\n    rules: [op.*]", 1), "wildcard")
}

func TestCatalogScopeSemanticsMatrix(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(string) string
		message string
	}{
		{"platform operation with roles", func(s string) string {
			return strings.Replace(s, "scope: platform\n    assurance", "scope: platform\n    allowed_project_roles: [role_caller]\n    assurance", 1)
		}, "platform operation cannot declare"},
		{"project operation without project roles", func(s string) string {
			return strings.Replace(s, "allowed_project_roles: [role_caller]", "", 1)
		}, "project_path operation requires project roles"},
		{"project operation with workspace roles", func(s string) string {
			return strings.Replace(s, "allowed_project_roles: [role_caller]", "allowed_project_roles: [role_caller]\n    allowed_workspace_roles: [role_ws_a]", 1)
		}, "forbids workspace roles"},
		{"credential scope with session auth", func(s string) string {
			return strings.Replace(s, "auth_method: scoped_token", "auth_method: session", 1)
		}, "project_credential operation requires"},
		{"machine operation with person roles", func(s string) string {
			return strings.Replace(s, "auth_method: scoped_token", "auth_method: machine_credential", 1)
		}, "machine_credential operation cannot declare person"},
		{"session operation without assurance", func(s string) string {
			return strings.Replace(s, "assurance: aal1", "assurance: none", 1)
		}, "must declare aal1 or aal2"},
		{"non-session operation with assurance", func(s string) string {
			return strings.Replace(s, "  - operation_id: op.project.token_read\n    auth_method: scoped_token\n    scope: project_credential\n    allowed_project_roles: [role_manager]\n    assurance: none",
				"  - operation_id: op.project.token_read\n    auth_method: scoped_token\n    scope: project_credential\n    allowed_project_roles: [role_manager]\n    assurance: aal2", 1)
		}, "non-session operation cannot declare assurance"},
		{"mfa recent auth without aal2", func(s string) string {
			return strings.Replace(s, "assurance: aal1\n    recent_auth: none\n    idempotency: none\n  - operation_id: op.project.token_read",
				"assurance: aal1\n    recent_auth: password_and_mfa_600s\n    idempotency: none\n  - operation_id: op.project.token_read", 1)
		}, "password_and_mfa_600s recent_auth requires aal2"},
		{"unauthenticated outside platform", func(s string) string {
			return strings.Replace(s, "auth_method: unauthenticated\n    scope: platform", "auth_method: unauthenticated\n    scope: workspace_path", 1)
		}, "unauthenticated operation must use platform scope"},
		{"workspace operation with project roles", func(s string) string {
			return strings.Replace(s, "auth_method: unauthenticated\n    scope: platform",
				"auth_method: session\n    scope: workspace_path\n    allowed_workspace_roles: [role_ws_a]\n    allowed_project_roles: [role_caller]", 1)
		}, "forbids project roles"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			mutated := test.mutate(validCatalogYAML)
			if mutated == validCatalogYAML {
				t.Fatalf("test mutation did not apply")
			}
			assertParseError(t, mutated, test.message)
		})
	}
}

func TestCatalogRuleClosureAgainstRegistry(t *testing.T) {

	assertParseError(t, strings.Replace(validCatalogYAML,
		"idempotency: none", "idempotency: none\n    rules: [assurance]", 1),
		"builtin rule")

	registry := NewRegistry()
	if err := registry.Register(maintenanceRule{}); err != nil {
		t.Fatal(err)
	}
	raw := strings.Replace(validCatalogYAML,
		"idempotency: none", "idempotency: none\n    rules: [maintenance_mode]", 1)
	catalog, err := ParseCatalog([]byte(raw), registry)
	if err != nil {
		t.Fatalf("ParseCatalog with registered rule: %v", err)
	}

	operation, ok := catalog.Operation("op.project.read")
	if !ok || len(operation.Rules) != 1 {
		t.Fatalf("operation = %+v, rules missing", operation)
	}
	rules, err := registry.Resolve(operation.Rules)
	if err != nil || len(rules) != 1 || rules[0].RuleName() != "maintenance_mode" {
		t.Fatalf("Resolve = %+v, %v", rules, err)
	}
}
