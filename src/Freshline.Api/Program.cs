using System.Text.Json.Serialization;
using Freshline.Api.Authentication;
using Freshline.Api.Cors;
using Freshline.Api.Endpoints;
using Freshline.Api.Health;
using Freshline.Api.OpenApi;
using Freshline.Api.RateLimiting;
using Freshline.Infrastructure.DependencyInjection;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Scalar.AspNetCore;

var builder = WebApplication.CreateBuilder(args);

// The database and the read path over it — and deliberately not AddFreshlineInfrastructure, which
// would also register the NYC connector's HttpClient and refuse to start without that source's
// configuration. The API never fetches from a portal.
builder.Services.AddFreshlinePersistence(builder.Configuration);

// One error shape for the whole API: RFC 9457 ProblemDetails. Without this, a failure returns
// either an empty body or, in development, an HTML stack trace page — two different contracts for
// the same API depending on the environment it happens to be running in.
builder.Services.AddProblemDetails();

builder.Services.ConfigureHttpJsonOptions(options =>
{
    // Enums as their names, not their numbers. The default writes Outcome as 1, which tells a
    // client nothing and silently changes meaning if anyone ever reorders the enum. "Good" cannot
    // be misread and cannot drift.
    options.SerializerOptions.Converters.Add(new JsonStringEnumConverter());

    // Nulls are written rather than omitted. A field that disappears when it is null makes callers
    // distinguish "absent" from "null" for no reason, and here null is frequently the answer:
    // a grade is null on a large share of inspections, and coordinates are null on some
    // establishments. Those are facts about the data and the response should state them.
});

builder.Services.AddFreshlineCors(builder.Configuration, builder.Environment);
builder.Services.AddPublicApiRateLimiting(builder.Configuration);
builder.Services.AddFreshlineJwtAuthentication(builder.Configuration);

builder.Services.AddOpenApi(options => options.AddBearerSecurityScheme());

builder.Services
    .AddHealthChecks()
    .AddCheck<ReadinessHealthCheck>("database", tags: [ReadinessHealthCheck.ReadyTag]);

var app = builder.Build();

// Turns an unhandled exception into a 500 ProblemDetails with no stack trace, rather than into a
// developer exception page. Registered first so it wraps everything after it.
app.UseExceptionHandler();

// Gives a ProblemDetails body to responses that have a status code and no body of their own —
// the 404 from a route that matched nothing, the 405 from a wrong verb. Without it those come back
// with an empty body, which is a different error contract for exactly the failures a caller is
// most likely to hit while learning the API.
app.UseStatusCodePages();

app.UseHttpsRedirection();

// Before UseRateLimiter, and the order is load-bearing rather than conventional.
//
// CORS middleware attaches its headers on the way in, so a response produced by anything after it
// still carries them. Put the rate limiter first instead and a 429 goes back with no CORS headers on
// it — at which point the browser refuses to hand the response to the calling script and reports a
// generic network failure. The client would be unable to tell "you are being throttled, here is how
// long to wait" apart from "the API is down", which is the one distinction the 429 exists to make.
//
// It also means a CORS preflight never reaches the limiter. UseCors answers OPTIONS itself and
// short-circuits, so a cross-origin GET costs one token rather than two.
app.UseCors(CrossOriginPolicy.PolicyName);

// Before authentication, and that ordering is a choice worth defending.
//
// The usual guidance puts the rate limiter after authentication, so a policy can partition by user.
// This one partitions by IP and has no interest in who the caller is, which frees the cheaper check
// to run first — and RSA signature verification is not cheap. Validating a flood of forged tokens
// before deciding to refuse them would be paying an attacker's bill for them.
app.UseRateLimiter();

app.UseAuthentication();
app.UseAuthorization();

// The OpenAPI document and its UI are served in every environment, not just development.
//
// That is the opposite of the usual advice, and it is a deliberate reading of what this API is:
// the read paths are public and anonymous by design, so the document describes nothing a caller
// could not discover by using it. M4 is done when a stranger can explore live Swagger, and gating
// it to development would mean that criterion is only ever met on a machine no stranger can reach.
app.MapOpenApi();
app.MapScalarApiReference(options => options.WithTitle("Freshline API"));

// Liveness: is this process up and answering. It runs no checks — that is what Predicate false
// means — because a liveness probe that fails when a dependency is down causes a restart that
// cannot fix a dependency.
app.MapHealthChecks("/health", new HealthCheckOptions { Predicate = _ => false });

// Readiness: can this instance serve a request right now. Runs the database check, so it reports
// unhealthy when the store is unreachable — which is the situation a load balancer should react to
// by sending traffic elsewhere rather than by restarting anything.
app.MapHealthChecks("/health/ready", new HealthCheckOptions
{
    Predicate = registration => registration.Tags.Contains(ReadinessHealthCheck.ReadyTag),
});

// Version in the path, as a literal string. A versioning package would add a configuration surface
// and a dependency for a v1 that has no v2; the discipline that actually matters is evolving
// without a v2 at all — add optional fields, never remove or repurpose one.
//
// Rate limiting is applied to this group, which is to say to the three endpoints that reach the
// database — and deliberately not to the health checks above it.
//
// A readiness probe is polled continuously from a small number of addresses, so it is exactly the
// traffic a per-IP limiter would classify as abuse. Throttling it would give the load balancer a 429,
// which it reads as "this instance is unhealthy", which takes the instance out of rotation. The
// limiter would then be the outage. The OpenAPI document and its UI are also outside the group; they
// touch no database and are the first thing the stranger in this milestone's acceptance criterion
// loads.
RouteGroupBuilder api = app
    .MapGroup("/api/v1")
    .RequireRateLimiting(PublicApiRateLimiting.PolicyName)

    // Declared on the same group that applies the policy, so the documentation cannot describe a
    // different set of endpoints from the one being throttled. A 429 only appears under load, which
    // makes it exactly the response a client author will not have handled unless the document said
    // it was possible.
    .ProducesProblem(StatusCodes.Status429TooManyRequests);

api.MapEstablishmentEndpoints();
api.MapIdentityEndpoints();

app.Run();

// Exposes the implicitly-generated Program class to the test project so
// WebApplicationFactory<Program> can start the real host. Top-level statements
// generate an internal class, which the test assembly otherwise cannot see.
public partial class Program;
