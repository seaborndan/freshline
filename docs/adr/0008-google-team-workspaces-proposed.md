# ADR-0008 — Google-backed team workspaces (proposed, not enabled)

## Status

Prepared for human review. Owner selected Google accounts. This proposal is not deployed and
does not claim that local lists are shared. `CLAUDE.md` requires line-by-line human review for
authentication / authorization and schema / migration changes. No active auth or schema change
is included in the current product pass.

## Decision to review

Use a server-side OpenID Connect authorization-code flow with Google, followed by a secure
application session. Identify accounts by verified issuer + subject, never email alone. Google
sign-in establishes identity; server-side workspace membership establishes access. Keep public
restaurant reads anonymous. Team records must never inherit that public-read policy.

Official protocol references: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
and [web-server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server).

## Concrete first release

- Owner creates a workspace. Owner invites members through explicit, expiring, single-use invitations.
- Members view shared lists, add activities and update assigned restaurants; owners manage members.
- Every list, saved restaurant, activity and assignment belongs to a workspace. All reads and writes
  check membership on the server; changing a client workspace ID cannot grant access.
- Restaurant assignments reference current workspace members. Email addresses are display/contact
  information, not authorization keys. Removing a member revokes access and unassigns their work.
- Updates use an optimistic concurrency token. Conflicts return 409 and do not silently replace notes.
- Local import is a previewed operation with explicit merge decisions. No automatic upload of local
  notes occurs at sign-in. Original browser-local work remains until the owner chooses otherwise.
- A team activity log records actor, time and action. Deletion/retention/export rules are documented
  before collecting team data in production.

## Proposed server routes

| Route | Behavior | Access |
| --- | --- | --- |
| GET /auth/google/start | Begin code flow with state, nonce and PKCE | Public initiation |
| GET /auth/google/callback | Verify callback and create application session | Valid code and state |
| POST /auth/logout | End session with CSRF protection | Signed-in session |
| GET /api/v1/workspaces | Membership-scoped workspace list | Signed in |
| POST /api/v1/workspaces | Create workspace and owner membership transactionally | Signed in |
| GET/POST /api/v1/workspaces/{id}/lists | Scoped list read/create | Member |
| PATCH /api/v1/workspaces/{id}/lists/{listId}/restaurants/{id} | Notes/stage/assignment with version check | Member |
| POST /api/v1/workspaces/{id}/invitations | Issue expiring invitation | Owner |
| POST /api/v1/invitations/{token}/accept | Consume invitation for intended verified account | Signed in |
| DELETE /api/v1/workspaces/{id}/members/{subject} | Revoke membership, protect final owner | Owner |

The existing token-validation `/me` endpoint is not a Google login implementation and must not
be repurposed without reviewing the existing issuer/audience trust configuration.

## Proposed storage changes

Review normalized tables for Accounts (issuer, subject), Workspaces, WorkspaceMembers,
WorkspaceInvitations (hashed token, intended identity, expiration, consumed timestamp), Lists,
SavedRestaurants (workspace/list/establishment unique membership, stage, notes, snapshot, assignee,
rowversion), and Activities (workspace/list/restaurant/actor/date/type/text). Foreign keys must
include workspace identity where needed to prevent cross-tenant references. Public establishment
IDs are references, not secrets or access grants. Cascades and owner deletion need explicit review.

Use EF migrations after the table design is accepted. Do not create a parallel JSON-file team
store or trust localStorage flags as a substitute for server authorization.

## Configuration still required

1. Google Cloud OAuth web client ID and authorized redirect URI for the chosen HTTPS domain.
2. Client secret stored in local user secrets or the deployment secret store, never repository files
   or chat. A public client ID is not enough for the chosen confidential server flow.
3. Production API/application origin, secure cookie policy, proxy configuration and allowed redirects.
4. Review of the chosen maintained OIDC integration package, migration and permission tests.

## Acceptance tests before enabling

Reject wrong issuer/audience/signature/nonce/expired tokens and reused callbacks; reject missing
CSRF tokens; prevent open redirects and session fixation. Prove one workspace cannot read or mutate
another's lists, activities, assignments or invitations. Test invitation replay/expiry, member
revocation, simultaneous note edits, final-owner protection and local-import conflicts. Test with
two real Google accounts against the configured callback before claiming shared work is available.
