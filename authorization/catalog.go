package authorization

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"

	"go.yaml.in/yaml/v3"
)

const CurrentCatalogSchemaVersion = 1

type AuthMethod string

const (
	AuthMethodUnauthenticated   AuthMethod = "unauthenticated"
	AuthMethodSession           AuthMethod = "session"
	AuthMethodScopedToken       AuthMethod = "scoped_token"
	AuthMethodMachineCredential AuthMethod = "machine_credential"
)

func (m AuthMethod) valid() bool {
	switch m {
	case AuthMethodUnauthenticated, AuthMethodSession, AuthMethodScopedToken, AuthMethodMachineCredential:
		return true
	default:
		return false
	}
}

type Assurance string

const (
	AssuranceNone Assurance = "none"
	AssuranceAAL1 Assurance = "aal1"
	AssuranceAAL2 Assurance = "aal2"
)

func (a Assurance) valid() bool {
	switch a {
	case AssuranceNone, AssuranceAAL1, AssuranceAAL2:
		return true
	default:
		return false
	}
}

type RecentAuthRule string

const (
	RecentAuthNone           RecentAuthRule = "none"
	RecentAuthPassword       RecentAuthRule = "password_600s"
	RecentAuthPasswordAndMFA RecentAuthRule = "password_and_mfa_600s"
)

func (r RecentAuthRule) valid() bool {
	switch r {
	case RecentAuthNone, RecentAuthPassword, RecentAuthPasswordAndMFA:
		return true
	default:
		return false
	}
}

type IdempotencyRule string

const (
	IdempotencyNone     IdempotencyRule = "none"
	IdempotencyRequired IdempotencyRule = "required"
)

func (r IdempotencyRule) valid() bool {
	switch r {
	case IdempotencyNone, IdempotencyRequired:
		return true
	default:
		return false
	}
}

type Catalog struct {
	CatalogSchemaVersion int         `yaml:"catalog_schema_version" json:"catalog_schema_version"`
	Roles                RoleVocab   `yaml:"roles" json:"roles"`
	Operations           []Operation `yaml:"operations" json:"operations"`
}

type RoleVocab struct {
	Workspace []string `yaml:"workspace" json:"workspace"`
	Project   []string `yaml:"project" json:"project"`
}

type Operation struct {
	OperationID           string          `yaml:"operation_id" json:"operation_id"`
	AuthMethod            AuthMethod      `yaml:"auth_method" json:"auth_method"`
	Scope                 ScopeKind       `yaml:"scope" json:"scope"`
	AllowedWorkspaceRoles []string        `yaml:"allowed_workspace_roles" json:"allowed_workspace_roles,omitempty"`
	AllowedProjectRoles   []string        `yaml:"allowed_project_roles" json:"allowed_project_roles,omitempty"`
	Assurance             Assurance       `yaml:"assurance" json:"assurance"`
	RecentAuth            RecentAuthRule  `yaml:"recent_auth" json:"recent_auth"`
	Idempotency           IdempotencyRule `yaml:"idempotency" json:"idempotency"`

	Rules []string `yaml:"rules" json:"rules,omitempty"`
}

func (c Catalog) Operation(operationID string) (Operation, bool) {
	for _, operation := range c.Operations {
		if operation.OperationID == operationID {
			return operation, true
		}
	}
	return Operation{}, false
}

func ParseCatalog(raw []byte, reg *Registry) (Catalog, error) {
	decoder := yaml.NewDecoder(bytes.NewReader(raw))
	decoder.KnownFields(true)
	var catalog Catalog
	if err := decoder.Decode(&catalog); err != nil {
		return Catalog{}, fmt.Errorf("authorization: decode catalog: %w", err)
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return Catalog{}, errors.New("authorization: decode catalog: multiple YAML documents are not allowed")
		}
		return Catalog{}, fmt.Errorf("authorization: decode catalog: %w", err)
	}
	if reg == nil {
		reg = NewRegistry()
	}
	if err := catalog.Validate(reg); err != nil {
		return Catalog{}, err
	}
	return catalog.normalized(), nil
}

func (c Catalog) Validate(reg *Registry) error {
	normalized := c.normalized()
	if err := normalized.validateStructure(); err != nil {
		return err
	}
	if reg == nil {
		reg = NewRegistry()
	}
	return normalized.validateRuleClosure(reg)
}

func (c Catalog) Hash() (string, error) {
	normalized := c.normalized()
	if err := normalized.validateStructure(); err != nil {
		return "", err
	}
	document, err := json.Marshal(normalized)
	if err != nil {
		return "", fmt.Errorf("authorization: encode catalog for hashing: %w", err)
	}
	digest := sha256.Sum256(document)
	return hex.EncodeToString(digest[:]), nil
}

func (c Catalog) normalized() Catalog {
	out := c
	out.Roles.Workspace = normalizeNames(c.Roles.Workspace)
	out.Roles.Project = normalizeNames(c.Roles.Project)
	operations := make([]Operation, len(c.Operations))
	for i, operation := range c.Operations {
		if operation.Assurance == "" {
			operation.Assurance = AssuranceNone
		}
		if operation.RecentAuth == "" {
			operation.RecentAuth = RecentAuthNone
		}
		if operation.Idempotency == "" {
			operation.Idempotency = IdempotencyNone
		}
		operation.AllowedWorkspaceRoles = normalizeNames(operation.AllowedWorkspaceRoles)
		operation.AllowedProjectRoles = normalizeNames(operation.AllowedProjectRoles)
		operation.Rules = normalizeNames(operation.Rules)
		operations[i] = operation
	}
	slices.SortFunc(operations, func(a, b Operation) int {
		return strings.Compare(a.OperationID, b.OperationID)
	})
	out.Operations = operations
	return out
}

func normalizeNames(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	out := slices.Clone(values)
	slices.Sort(out)
	return out
}

func (c Catalog) validateStructure() error {
	if c.CatalogSchemaVersion != CurrentCatalogSchemaVersion {
		return fmt.Errorf("authorization: catalog_schema_version %d is unsupported (want %d)",
			c.CatalogSchemaVersion, CurrentCatalogSchemaVersion)
	}
	for field, names := range map[string][]string{
		"roles.workspace": c.Roles.Workspace,
		"roles.project":   c.Roles.Project,
	} {
		seen := make(map[string]struct{}, len(names))
		for _, name := range names {
			if err := validateClosedName(field, name); err != nil {
				return err
			}
			if _, duplicate := seen[name]; duplicate {
				return fmt.Errorf("authorization: %s: duplicate role %q", field, name)
			}
			seen[name] = struct{}{}
		}
	}
	workspaceRoles := nameSet(c.Roles.Workspace)
	projectRoles := nameSet(c.Roles.Project)
	operationIDs := make(map[string]struct{}, len(c.Operations))
	for i, operation := range c.Operations {
		if err := validateClosedName(fmt.Sprintf("operations[%d].operation_id", i), operation.OperationID); err != nil {
			return err
		}
		if _, duplicate := operationIDs[operation.OperationID]; duplicate {
			return fmt.Errorf("authorization: operations[%d]: duplicate operation_id %q", i, operation.OperationID)
		}
		operationIDs[operation.OperationID] = struct{}{}
		if !operation.AuthMethod.valid() {
			return fmt.Errorf("authorization: operation %q: unknown auth_method %q", operation.OperationID, operation.AuthMethod)
		}
		if !operation.Scope.valid() {
			return fmt.Errorf("authorization: operation %q: unknown scope %q", operation.OperationID, operation.Scope)
		}
		if !operation.Assurance.valid() {
			return fmt.Errorf("authorization: operation %q: unknown assurance %q", operation.OperationID, operation.Assurance)
		}
		if !operation.RecentAuth.valid() {
			return fmt.Errorf("authorization: operation %q: unknown recent_auth %q", operation.OperationID, operation.RecentAuth)
		}
		if !operation.Idempotency.valid() {
			return fmt.Errorf("authorization: operation %q: unknown idempotency %q", operation.OperationID, operation.Idempotency)
		}
		for _, role := range operation.AllowedWorkspaceRoles {
			if _, ok := workspaceRoles[role]; !ok {
				return fmt.Errorf("authorization: operation %q: workspace role %q is not declared in roles.workspace", operation.OperationID, role)
			}
		}
		for _, role := range operation.AllowedProjectRoles {
			if _, ok := projectRoles[role]; !ok {
				return fmt.Errorf("authorization: operation %q: project role %q is not declared in roles.project", operation.OperationID, role)
			}
		}
		for _, name := range operation.Rules {
			if err := validateClosedName(fmt.Sprintf("operation %q rules", operation.OperationID), name); err != nil {
				return err
			}
		}
		if err := validateOperationSemantics(operation); err != nil {
			return fmt.Errorf("authorization: operation %q: %w", operation.OperationID, err)
		}
	}
	return nil
}

func (c Catalog) validateRuleClosure(reg *Registry) error {
	for _, operation := range c.Operations {
		for _, name := range operation.Rules {
			if reg.IsBuiltin(name) {
				return fmt.Errorf("authorization: operation %q: rule %q is a builtin rule (referenced implicitly, not via rules)", operation.OperationID, name)
			}
			if _, ok := reg.Rule(name); !ok {
				return fmt.Errorf("authorization: operation %q: rule %q is not registered", operation.OperationID, name)
			}
		}
	}
	return nil
}

func validateOperationSemantics(op Operation) error {
	if op.AuthMethod == AuthMethodUnauthenticated && op.Scope != ScopeKindPlatform {
		return errors.New("unauthenticated operation must use platform scope")
	}
	switch op.Scope {
	case ScopeKindPlatform:
		if op.AuthMethod != AuthMethodUnauthenticated && op.AuthMethod != AuthMethodSession {
			return errors.New("platform operation must use unauthenticated or session auth_method")
		}
		if len(op.AllowedWorkspaceRoles) != 0 || len(op.AllowedProjectRoles) != 0 {
			return errors.New("platform operation cannot declare workspace or project roles")
		}
	case ScopeKindWorkspacePath, ScopeKindProjectGovernance:
		if op.AuthMethod != AuthMethodSession {
			return fmt.Errorf("%s operation must use session auth_method", op.Scope)
		}
		if len(op.AllowedWorkspaceRoles) == 0 || len(op.AllowedProjectRoles) != 0 {
			return fmt.Errorf("%s operation requires workspace roles and forbids project roles", op.Scope)
		}
	case ScopeKindProjectPath:
		if op.AuthMethod != AuthMethodSession {
			return errors.New("project_path operation must use session auth_method")
		}
		if len(op.AllowedProjectRoles) == 0 || len(op.AllowedWorkspaceRoles) != 0 {
			return errors.New("project_path operation requires project roles and forbids workspace roles")
		}
	case ScopeKindProjectCredential:
		if op.AuthMethod != AuthMethodScopedToken && op.AuthMethod != AuthMethodMachineCredential {
			return errors.New("project_credential operation requires scoped_token or machine_credential auth_method")
		}
		if len(op.AllowedWorkspaceRoles) != 0 {
			return errors.New("project_credential operation cannot declare workspace roles")
		}
		if op.AuthMethod == AuthMethodScopedToken && len(op.AllowedProjectRoles) == 0 {
			return errors.New("scoped_token operation requires project roles")
		}
		if op.AuthMethod == AuthMethodMachineCredential && len(op.AllowedProjectRoles) != 0 {
			return errors.New("machine_credential operation cannot declare person project roles")
		}
	default:
		return fmt.Errorf("unknown scope %q", op.Scope)
	}

	if op.AuthMethod == AuthMethodSession {
		if op.Assurance != AssuranceAAL1 && op.Assurance != AssuranceAAL2 {
			return errors.New("session operation must declare aal1 or aal2 assurance")
		}
		if op.RecentAuth == RecentAuthPasswordAndMFA && op.Assurance != AssuranceAAL2 {
			return errors.New("password_and_mfa_600s recent_auth requires aal2 assurance")
		}
	} else {
		if op.Assurance != AssuranceNone {
			return errors.New("non-session operation cannot declare assurance")
		}
		if op.RecentAuth != RecentAuthNone {
			return errors.New("non-session operation cannot declare recent_auth")
		}
	}
	return nil
}

func validateClosedName(field, name string) error {
	if name == "" {
		return fmt.Errorf("authorization: %s: empty name is not allowed", field)
	}
	if strings.ContainsAny(name, " \t\r\n*") {
		return fmt.Errorf("authorization: %s: %q must not contain whitespace or wildcard %q", field, name, "*")
	}
	return nil
}

func nameSet(names []string) map[string]struct{} {
	out := make(map[string]struct{}, len(names))
	for _, name := range names {
		out[name] = struct{}{}
	}
	return out
}
