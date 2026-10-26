package legal

import (
	"context"

	"github.com/haozing/ploykit/identity"
	"github.com/haozing/ploykit/platform/webx"
)

// Hooks returns the identity hook surface for acceptance evidence (LC-3,
// audit L3). Compose it with the other hooks a product already wires —
// identity services take exactly one hook value, so use identity.ChainHooks:
//
//	sessions.WithHooks(identity.ChainHooks(
//		provisioning.PersonalWorkspace(cfg), legalMod.Hooks()))
//
// Both hooks honor the identity contract verbatim: they are idempotent (the
// (user_id, doc_key, doc_version) unique key + ON CONFLICT DO NOTHING — not
// code discipline), and they return errors instead of logging, letting the
// identity firing sites apply their documented semantics — AfterRegister
// failures become LoginResult.ProvisioningPending and re-fire on the next
// login; AfterLogin failures are logged at WARN and never block the login.
// With no registered docs both hooks are no-ops.
func (m *Module) Hooks() identity.IdentityHooks {
	return identity.IdentityHooks{
		AfterRegister: m.afterRegister,
		AfterLogin:    m.afterLogin,
	}
}

// afterRegister records a signup acceptance for EVERY registered doc —
// registration paths are the strongest consent signal and the identity
// contract fires this hook on all of them (password, admin create, OAuth
// JIT, code JIT).
func (m *Module) afterRegister(ctx context.Context, userID string) error {
	docs := RegisteredDocs()
	if len(docs) == 0 {
		return nil
	}
	return m.repo.InsertAcceptances(ctx, rowsFor(userID, docs, MethodSignup, evidenceFrom(ctx)))
}

// afterLogin backfills login_implicit acceptances: only docs whose CURRENT
// version the user has never recorded (any method) get a row, so the steady
// state is one lookup per login and zero writes. This is also the
// convergence path for an AfterRegister failure: the next login writes what
// the registration could not.
func (m *Module) afterLogin(ctx context.Context, userID, _ string) error {
	docs := RegisteredDocs()
	if len(docs) == 0 {
		return nil
	}
	missing, err := m.repo.UnacceptedDocs(ctx, userID, docs)
	if err != nil {
		return err
	}
	if len(missing) == 0 {
		return nil
	}
	return m.repo.InsertAcceptances(ctx, rowsFor(userID, missing, MethodLoginImplicit, evidenceFrom(ctx)))
}

// evidence captures the request's client environment from the ctx carriers
// injected by the webx middleware: the server-resolved IP
// (webx.ClientMetadata, same source as the access log) and the
// self-reported platform triple. Structured values only — the raw
// User-Agent string is deliberately never stored.
type evidence struct {
	ip, platform, version, os string
}

func evidenceFrom(ctx context.Context) evidence {
	var e evidence
	e.ip = webx.ClientIPFrom(ctx)
	e.platform, e.version, e.os = webx.ClientMetadataFrom(ctx)
	return e
}

// rowsFor builds one evidence row per doc with the same captured client
// environment; the repo's ON CONFLICT DO NOTHING keeps every row idempotent.
func rowsFor(userID string, docs []Doc, method string, env evidence) []Acceptance {
	rows := make([]Acceptance, 0, len(docs))
	for _, d := range docs {
		rows = append(rows, Acceptance{
			UserID:         userID,
			DocKey:         d.Key,
			DocVersion:     d.Version,
			Method:         method,
			IP:             env.ip,
			ClientPlatform: env.platform,
			ClientVersion:  env.version,
			ClientOS:       env.os,
		})
	}
	return rows
}
