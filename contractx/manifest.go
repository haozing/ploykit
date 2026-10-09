package contractx

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
)

type Entry struct {
	ID         string              `json:"id"`
	Attributes map[string][]string `json:"attributes,omitempty"`
}

type ManifestInput struct {
	PolicyVersion int64

	SchemaVersion int64

	RequiredCapabilities []string

	AttributeBindings []string

	ExternalHashes map[string]string

	PolicyVersions map[string]int64
}

type Manifest struct {
	EntriesHash            string            `json:"entries_hash"`
	EntrySetHash           string            `json:"entry_set_hash"`
	PolicyVersion          int64             `json:"policy_version"`
	SchemaVersion          int64             `json:"schema_version"`
	AttributeBindingHashes map[string]string `json:"attribute_binding_hashes,omitempty"`
	ExternalHashes         map[string]string `json:"external_hashes,omitempty"`
	PolicyVersions         map[string]int64  `json:"policy_versions,omitempty"`
	RequiredCapabilities   []string          `json:"required_capabilities"`
}

type EntryHashes struct {
	EntriesHash   string
	EntrySetHash  string
	BindingHashes map[string]string
}

type bindingRow struct {
	ID     string   `json:"id"`
	Values []string `json:"values"`
}

func BuildManifest(entries []Entry, input ManifestInput) (Manifest, error) {
	if input.PolicyVersion < 1 {
		return Manifest{}, errors.New("contractx: policy_version must be positive")
	}
	if input.SchemaVersion < 1 {
		return Manifest{}, errors.New("contractx: schema_version must be positive")
	}
	for name, version := range input.PolicyVersions {
		if strings.TrimSpace(name) == "" {
			return Manifest{}, errors.New("contractx: policy_versions contains a blank name")
		}
		if version < 1 {
			return Manifest{}, fmt.Errorf("contractx: policy_versions[%q] must be positive", name)
		}
	}
	for name, digest := range input.ExternalHashes {
		if strings.TrimSpace(name) == "" {
			return Manifest{}, errors.New("contractx: external_hashes contains a blank name")
		}
		if !isSHA256Hex(digest) {
			return Manifest{}, fmt.Errorf("contractx: external_hashes[%q] must be a lowercase SHA-256 hex digest", name)
		}
	}
	capabilities, err := normalizeCapabilitySet(input.RequiredCapabilities)
	if err != nil {
		return Manifest{}, err
	}
	bindings, err := normalizeNameList(input.AttributeBindings, "attribute_bindings")
	if err != nil {
		return Manifest{}, err
	}
	normalized, err := normalizeEntries(entries)
	if err != nil {
		return Manifest{}, err
	}
	for _, name := range bindings {
		if !anyEntryDeclares(normalized, name) {
			return Manifest{}, fmt.Errorf("contractx: attribute_bindings references %q which no entry declares", name)
		}
	}
	hashes, err := hashNormalizedEntries(normalized, bindings)
	if err != nil {
		return Manifest{}, err
	}
	manifest := Manifest{
		EntriesHash:          hashes.EntriesHash,
		EntrySetHash:         hashes.EntrySetHash,
		PolicyVersion:        input.PolicyVersion,
		SchemaVersion:        input.SchemaVersion,
		RequiredCapabilities: capabilities,
	}
	if len(hashes.BindingHashes) > 0 {
		manifest.AttributeBindingHashes = hashes.BindingHashes
	}
	if len(input.ExternalHashes) > 0 {
		manifest.ExternalHashes = input.ExternalHashes
	}
	if len(input.PolicyVersions) > 0 {
		manifest.PolicyVersions = input.PolicyVersions
	}
	return manifest, nil
}

func HashEntries(entries []Entry, bindings []string) (EntryHashes, error) {
	names, err := normalizeNameList(bindings, "attribute_bindings")
	if err != nil {
		return EntryHashes{}, err
	}
	normalized, err := normalizeEntries(entries)
	if err != nil {
		return EntryHashes{}, err
	}
	for _, name := range names {
		if !anyEntryDeclares(normalized, name) {
			return EntryHashes{}, fmt.Errorf("contractx: attribute_bindings references %q which no entry declares", name)
		}
	}
	return hashNormalizedEntries(normalized, names)
}

func (m Manifest) Render() ([]byte, error) {
	rendered, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("contractx: render manifest: %w", err)
	}
	return append(rendered, '\n'), nil
}

func ParseManifest(raw []byte) (Manifest, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var manifest Manifest
	if err := decoder.Decode(&manifest); err != nil {
		return Manifest{}, fmt.Errorf("contractx: parse manifest: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return Manifest{}, errors.New("contractx: parse manifest: expected exactly one JSON value")
	}
	return manifest, nil
}

func (m Manifest) Equal(other Manifest) bool {
	left, err := m.Render()
	if err != nil {
		return false
	}
	right, err := other.Render()
	if err != nil {
		return false
	}
	return bytes.Equal(left, right)
}

func normalizeEntries(entries []Entry) ([]Entry, error) {
	if len(entries) == 0 {
		return nil, errors.New("contractx: entry set is empty")
	}
	normalized := make([]Entry, 0, len(entries))
	seen := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		id := strings.TrimSpace(entry.ID)
		if id == "" {
			return nil, errors.New("contractx: entry with blank id")
		}
		if _, dup := seen[id]; dup {
			return nil, fmt.Errorf("contractx: duplicate entry id %q", id)
		}
		seen[id] = struct{}{}
		var attributes map[string][]string
		if len(entry.Attributes) > 0 {
			attributes = make(map[string][]string, len(entry.Attributes))
			for name, values := range entry.Attributes {
				name = strings.TrimSpace(name)
				if name == "" {
					return nil, fmt.Errorf("contractx: entry %q has a blank attribute name", id)
				}
				copied := make([]string, 0, len(values))
				for _, value := range values {
					value = strings.TrimSpace(value)
					if value == "" {
						return nil, fmt.Errorf("contractx: entry %q attribute %q contains a blank value", id, name)
					}
					copied = append(copied, value)
				}
				if len(copied) == 0 {
					continue
				}
				sort.Strings(copied)
				for i := 1; i < len(copied); i++ {
					if copied[i] == copied[i-1] {
						return nil, fmt.Errorf("contractx: entry %q attribute %q contains duplicate value %q", id, name, copied[i])
					}
				}
				attributes[name] = copied
			}
		}
		normalized = append(normalized, Entry{ID: id, Attributes: attributes})
	}
	sort.Slice(normalized, func(i, j int) bool { return normalized[i].ID < normalized[j].ID })
	return normalized, nil
}

func hashNormalizedEntries(entries []Entry, bindings []string) (EntryHashes, error) {
	ids := make([]string, len(entries))
	for i, entry := range entries {
		ids[i] = entry.ID
	}
	entriesHash, err := HashJSON(entries)
	if err != nil {
		return EntryHashes{}, err
	}
	entrySetHash, err := HashJSON(ids)
	if err != nil {
		return EntryHashes{}, err
	}
	hashes := EntryHashes{EntriesHash: entriesHash, EntrySetHash: entrySetHash}
	if len(bindings) > 0 {
		hashes.BindingHashes = make(map[string]string, len(bindings))
		for _, name := range bindings {
			rows := make([]bindingRow, 0, len(entries))
			for _, entry := range entries {
				if values, ok := entry.Attributes[name]; ok {
					rows = append(rows, bindingRow{ID: entry.ID, Values: values})
				}
			}
			digest, err := HashJSON(rows)
			if err != nil {
				return EntryHashes{}, err
			}
			hashes.BindingHashes[name] = digest
		}
	}
	return hashes, nil
}

func normalizeCapabilitySet(capabilities []string) ([]string, error) {
	if len(capabilities) == 0 {
		return nil, errors.New("contractx: required_capabilities must not be empty")
	}
	normalized, err := normalizeNameList(capabilities, "required_capabilities")
	if err != nil {
		return nil, err
	}
	return normalized, nil
}

func normalizeNameList(names []string, field string) ([]string, error) {
	if len(names) == 0 {
		return nil, nil
	}
	copied := make([]string, 0, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" {
			return nil, fmt.Errorf("contractx: %s contains a blank value", field)
		}
		copied = append(copied, name)
	}
	sort.Strings(copied)
	for i := 1; i < len(copied); i++ {
		if copied[i] == copied[i-1] {
			return nil, fmt.Errorf("contractx: %s contains duplicate %q", field, copied[i])
		}
	}
	return copied, nil
}

func anyEntryDeclares(entries []Entry, attribute string) bool {
	for _, entry := range entries {
		if len(entry.Attributes[attribute]) > 0 {
			return true
		}
	}
	return false
}
