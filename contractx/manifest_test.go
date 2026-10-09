package contractx

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func manifestFixtureEntries() []Entry {
	return []Entry{
		{
			ID: "listTasks",
			Attributes: map[string][]string{
				"transport":         {"http"},
				"http_method":       {"GET"},
				"path":              {"/api/workspaces/{workspaceId}/tasks"},
				"response_contract": {"TaskListDTO"},
			},
		},
		{
			ID: "createTask",
			Attributes: map[string][]string{
				"transport":         {"http"},
				"http_method":       {"POST"},
				"path":              {"/api/workspaces/{workspaceId}/tasks"},
				"response_contract": {"TaskDTO"},
			},
		},
		{
			ID: "runNightlyRollup",
			Attributes: map[string][]string{
				"transport":         {"internal"},
				"response_contract": {"NoContent"},
			},
		},
	}
}

func validManifestInput() ManifestInput {
	return ManifestInput{
		PolicyVersion:        3,
		SchemaVersion:        1,
		RequiredCapabilities: []string{"pg-advisory-lock", "uuid-gen"},
		AttributeBindings:    []string{"response_contract"},
		ExternalHashes:       map[string]string{"security_inventory": strings.Repeat("0", 64)},
		PolicyVersions:       map[string]int64{"mfa_policy": 1, "token_policy": 2},
	}
}

func shuffledFixture() []Entry {
	return []Entry{
		{
			ID: "runNightlyRollup",
			Attributes: map[string][]string{
				"response_contract": {"NoContent"},
				"transport":         {"internal"},
			},
		},
		{
			ID: "createTask",
			Attributes: map[string][]string{
				"path":              {"/api/workspaces/{workspaceId}/tasks"},
				"response_contract": {"TaskDTO"},
				"http_method":       {"POST"},
				"transport":         {"http"},
			},
		},
		{
			ID: "listTasks",
			Attributes: map[string][]string{
				"response_contract": {"TaskListDTO"},
				"path":              {"/api/workspaces/{workspaceId}/tasks"},
				"transport":         {"http"},
				"http_method":       {"GET"},
			},
		},
	}
}

func TestBuildManifestDeterministic(t *testing.T) {
	first, err := BuildManifest(manifestFixtureEntries(), validManifestInput())
	if err != nil {
		t.Fatalf("first build: %v", err)
	}
	second, err := BuildManifest(manifestFixtureEntries(), validManifestInput())
	if err != nil {
		t.Fatalf("second build: %v", err)
	}
	if !first.Equal(second) {
		t.Fatalf("same input produced different manifests:\n%s\nvs\n%s", mustRender(t, first), mustRender(t, second))
	}
	firstRendered := mustRender(t, first)
	secondRendered := mustRender(t, second)
	if string(firstRendered) != string(secondRendered) {
		t.Fatal("rendered bytes differ for identical input")
	}
}

func TestBuildManifestOrderIndependent(t *testing.T) {
	ordered, err := BuildManifest(manifestFixtureEntries(), validManifestInput())
	if err != nil {
		t.Fatalf("ordered build: %v", err)
	}
	shuffled, err := BuildManifest(shuffledFixture(), validManifestInput())
	if err != nil {
		t.Fatalf("shuffled build: %v", err)
	}
	if !ordered.Equal(shuffled) {
		t.Fatalf("entry/value order changed the manifest:\n%s\nvs\n%s", mustRender(t, ordered), mustRender(t, shuffled))
	}
}

func TestBuildManifestEmptyAndAbsentAttributesEquivalent(t *testing.T) {
	withEmpty := []Entry{
		{ID: "a", Attributes: map[string][]string{"k": {"v"}, "empty": {}}},
	}
	without := []Entry{
		{ID: "a", Attributes: map[string][]string{"k": {"v"}}},
	}
	left, err := BuildManifest(withEmpty, ManifestInput{
		PolicyVersion: 1, SchemaVersion: 1, RequiredCapabilities: []string{"c"},
	})
	if err != nil {
		t.Fatalf("build with empty attribute: %v", err)
	}
	right, err := BuildManifest(without, ManifestInput{
		PolicyVersion: 1, SchemaVersion: 1, RequiredCapabilities: []string{"c"},
	})
	if err != nil {
		t.Fatalf("build without attribute: %v", err)
	}
	if !left.Equal(right) {
		t.Fatal("absent and empty attribute values must hash identically")
	}
}

func TestHashEntriesMatchesDirectCanonicalHash(t *testing.T) {

	canonical := []Entry{
		{ID: "createTask", Attributes: map[string][]string{
			"http_method":       {"POST"},
			"path":              {"/api/workspaces/{workspaceId}/tasks"},
			"response_contract": {"TaskDTO"},
			"transport":         {"http"},
		}},
		{ID: "listTasks", Attributes: map[string][]string{
			"http_method":       {"GET"},
			"path":              {"/api/workspaces/{workspaceId}/tasks"},
			"response_contract": {"TaskListDTO"},
			"transport":         {"http"},
		}},
		{ID: "runNightlyRollup", Attributes: map[string][]string{
			"response_contract": {"NoContent"},
			"transport":         {"internal"},
		}},
	}
	wantEntries, err := HashJSON(canonical)
	if err != nil {
		t.Fatalf("canonical entries hash: %v", err)
	}
	wantSet, err := HashJSON([]string{"createTask", "listTasks", "runNightlyRollup"})
	if err != nil {
		t.Fatalf("canonical set hash: %v", err)
	}
	type row struct {
		ID     string   `json:"id"`
		Values []string `json:"values"`
	}
	wantBinding, err := HashJSON([]row{
		{ID: "createTask", Values: []string{"TaskDTO"}},
		{ID: "listTasks", Values: []string{"TaskListDTO"}},
		{ID: "runNightlyRollup", Values: []string{"NoContent"}},
	})
	if err != nil {
		t.Fatalf("canonical binding hash: %v", err)
	}

	got, err := HashEntries(shuffledFixture(), []string{"response_contract"})
	if err != nil {
		t.Fatalf("HashEntries: %v", err)
	}
	if got.EntriesHash != wantEntries {
		t.Errorf("entries hash %s, want %s", got.EntriesHash, wantEntries)
	}
	if got.EntrySetHash != wantSet {
		t.Errorf("entry set hash %s, want %s", got.EntrySetHash, wantSet)
	}
	if got.BindingHashes["response_contract"] != wantBinding {
		t.Errorf("binding hash %s, want %s", got.BindingHashes["response_contract"], wantBinding)
	}
}

func TestBuildManifestValidation(t *testing.T) {
	cases := []struct {
		name    string
		entries []Entry
		mutate  func(*ManifestInput)
		wantErr string
	}{
		{
			name:    "empty entry set",
			entries: nil,
			wantErr: "entry set is empty",
		},
		{
			name:    "blank entry id",
			entries: []Entry{{ID: "  "}},
			wantErr: "blank id",
		},
		{
			name: "duplicate entry id",
			entries: []Entry{
				{ID: "a", Attributes: map[string][]string{"k": {"v"}}},
				{ID: "a", Attributes: map[string][]string{"k": {"w"}}},
			},
			wantErr: `duplicate entry id "a"`,
		},
		{
			name:    "blank attribute value",
			entries: []Entry{{ID: "a", Attributes: map[string][]string{"k": {"v", " "}}}},
			wantErr: "blank value",
		},
		{
			name:    "duplicate attribute value",
			entries: []Entry{{ID: "a", Attributes: map[string][]string{"k": {"v", "v"}}}},
			wantErr: `duplicate value "v"`,
		},
		{
			name:    "blank attribute name",
			entries: []Entry{{ID: "a", Attributes: map[string][]string{" ": {"v"}}}},
			wantErr: "blank attribute name",
		},
		{
			name:    "zero policy version",
			mutate:  func(in *ManifestInput) { in.PolicyVersion = 0 },
			wantErr: "policy_version must be positive",
		},
		{
			name:    "zero schema version",
			mutate:  func(in *ManifestInput) { in.SchemaVersion = 0 },
			wantErr: "schema_version must be positive",
		},
		{
			name:    "empty capabilities",
			mutate:  func(in *ManifestInput) { in.RequiredCapabilities = nil },
			wantErr: "required_capabilities must not be empty",
		},
		{
			name:    "blank capability",
			mutate:  func(in *ManifestInput) { in.RequiredCapabilities = []string{"ok", " "} },
			wantErr: "required_capabilities contains a blank value",
		},
		{
			name:    "duplicate capability",
			mutate:  func(in *ManifestInput) { in.RequiredCapabilities = []string{"pg-advisory-lock", "pg-advisory-lock"} },
			wantErr: `required_capabilities contains duplicate "pg-advisory-lock"`,
		},
		{
			name:    "invalid external hash",
			mutate:  func(in *ManifestInput) { in.ExternalHashes["security_inventory"] = "ZZ" },
			wantErr: "must be a lowercase SHA-256 hex digest",
		},
		{
			name:    "blank external hash name",
			mutate:  func(in *ManifestInput) { in.ExternalHashes[""] = strings.Repeat("a", 64) },
			wantErr: "external_hashes contains a blank name",
		},
		{
			name:    "zero named policy version",
			mutate:  func(in *ManifestInput) { in.PolicyVersions["mfa_policy"] = 0 },
			wantErr: `policy_versions["mfa_policy"] must be positive`,
		},
		{
			name:    "binding names unknown attribute",
			entries: []Entry{{ID: "a", Attributes: map[string][]string{"k": {"v"}}}},
			mutate:  func(in *ManifestInput) { in.AttributeBindings = []string{"no_such_attribute"} },
			wantErr: `references "no_such_attribute" which no entry declares`,
		},
		{
			name:    "blank binding name",
			mutate:  func(in *ManifestInput) { in.AttributeBindings = []string{" "} },
			wantErr: "attribute_bindings contains a blank value",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := validManifestInput()
			if tc.mutate != nil {
				tc.mutate(&input)
			}
			_, err := BuildManifest(tc.entries, input)
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tc.wantErr)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error %q does not contain %q", err.Error(), tc.wantErr)
			}
		})
	}
}

func TestManifestRenderGolden(t *testing.T) {
	manifest, err := BuildManifest([]Entry{
		{ID: "onlyOp", Attributes: map[string][]string{"http_method": {"GET"}, "path": {"/x"}}},
	}, ManifestInput{
		PolicyVersion:        1,
		SchemaVersion:        1,
		RequiredCapabilities: []string{"cap-b", "cap-a"},
	})
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	rendered := mustRender(t, manifest)
	goldenPath := "testdata/manifest_golden.json"
	if _, statErr := os.Stat(goldenPath); os.IsNotExist(statErr) {
		if writeErr := os.WriteFile(goldenPath, rendered, 0o644); writeErr != nil {
			t.Fatalf("seed golden file: %v", writeErr)
		}
		t.Fatalf("golden file absent; seeded %s — re-run tests to verify stability", goldenPath)
	}
	want, err := os.ReadFile(goldenPath)
	if err != nil {
		t.Fatalf("read golden: %v", err)
	}

	if string(rendered) != string(normalizeEOL(want)) {
		t.Fatalf("rendered manifest drifted from golden:\n%s\nwant:\n%s", rendered, want)
	}
}

func normalizeEOL(b []byte) []byte {
	if !bytes.ContainsRune(b, '\r') {
		return b
	}
	out := bytes.ReplaceAll(b, []byte("\r\n"), []byte("\n"))
	return bytes.ReplaceAll(out, []byte("\r"), []byte("\n"))
}

func TestManifestParseRoundTrip(t *testing.T) {
	manifest, err := BuildManifest(manifestFixtureEntries(), validManifestInput())
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	rendered := mustRender(t, manifest)
	parsed, err := ParseManifest(rendered)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if !parsed.Equal(manifest) {
		t.Fatal("round trip changed the manifest")
	}
}

func TestParseManifestStrictness(t *testing.T) {
	base := string(mustRender(t, mustBuild(t, []Entry{{ID: "a"}}, ManifestInput{
		PolicyVersion: 1, SchemaVersion: 1, RequiredCapabilities: []string{"c"},
	})))

	idx := strings.LastIndex(base, "\n}")
	if idx < 0 {
		t.Fatalf("unexpected render shape: %q", base)
	}
	withUnknown := base[:idx] + ",\n  \"surprise\": true\n}"
	if _, err := ParseManifest([]byte(withUnknown)); err == nil || !strings.Contains(err.Error(), "surprise") {
		t.Fatalf("unknown field not rejected: %v", err)
	}
	withTrailing := base + `{"second":"document"}`
	if _, err := ParseManifest([]byte(withTrailing)); err == nil || !strings.Contains(err.Error(), "exactly one JSON value") {
		t.Fatalf("trailing document not rejected: %v", err)
	}
}

func TestHashJSONCanonicalMapOrder(t *testing.T) {

	got, err := HashJSON(map[string]int{"zebra": 1, "alpha": 2})
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	want := hashBytes([]byte(`{"alpha":2,"zebra":1}`))
	if got != want {
		t.Fatalf("digest %s, want %s (map keys not canonically ordered)", got, want)
	}
}

func mustBuild(t *testing.T, entries []Entry, input ManifestInput) Manifest {
	t.Helper()
	manifest, err := BuildManifest(entries, input)
	if err != nil {
		t.Fatalf("build: %v", err)
	}
	return manifest
}

func mustRender(t *testing.T, manifest Manifest) []byte {
	t.Helper()
	rendered, err := manifest.Render()
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	return rendered
}
