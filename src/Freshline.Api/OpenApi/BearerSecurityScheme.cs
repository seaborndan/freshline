using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.OpenApi;
// Microsoft.OpenApi 2.x flattened its model types into the root namespace; there is no .Models here.
using Microsoft.OpenApi;

namespace Freshline.Api.OpenApi;

/// <summary>
/// Describes bearer authentication in the OpenAPI document, and marks the operations that require it.
///
/// <para><strong>Why this is not optional.</strong> <c>AddOpenApi</c> does not infer a security scheme
/// from registered authentication — verified by reading the generated document, which listed no
/// <c>securitySchemes</c> at all and no <c>security</c> on <c>/me</c>. The endpoint appeared in the
/// documentation as though anyone could call it and returned 401 to everyone who tried, with nothing
/// in the document saying why or anywhere in the UI to put a token. This milestone is done when a
/// stranger can explore live documentation and every endpoint is correct, and an endpoint whose
/// entry requirement is invisible does not meet that.</para>
///
/// <para>Applied per operation rather than as a document-level default, because a document-level
/// <c>security</c> block would describe the establishment endpoints as needing a token as well. They
/// are anonymous by design, and documentation that implies otherwise costs this API the exact thing
/// the public-map decision was made to protect.</para>
/// </summary>
internal static class BearerSecurityScheme
{
    private const string SchemeName = JwtBearerDefaults.AuthenticationScheme;

    public static OpenApiOptions AddBearerSecurityScheme(this OpenApiOptions options)
    {
        options.AddDocumentTransformer((document, context, cancellationToken) =>
        {
            document.Components ??= new OpenApiComponents();
            document.Components.SecuritySchemes ??= new Dictionary<string, IOpenApiSecurityScheme>();

            document.Components.SecuritySchemes[SchemeName] = new OpenApiSecurityScheme
            {
                Type = SecuritySchemeType.Http,
                Scheme = "bearer",
                BearerFormat = "JWT",
                In = ParameterLocation.Header,
                Description =
                    "A JSON Web Token in the Authorization header, as `Bearer <token>`. This API " +
                    "validates tokens and does not issue them, so there is no endpoint here to " +
                    "obtain one from — that is a separate concern with its own storage and rotation " +
                    "story. The establishment endpoints need no token and never will.",
            };

            return Task.CompletedTask;
        });

        options.AddOperationTransformer((operation, context, cancellationToken) =>
        {
            // Driven by the endpoint's own authorization metadata rather than by a list of paths, so
            // an endpoint that gains or loses RequireAuthorization cannot end up documented as the
            // opposite of what it enforces.
            bool requiresAuthorization = context.Description.ActionDescriptor.EndpointMetadata
                .OfType<IAuthorizeData>()
                .Any();

            if (requiresAuthorization)
            {
                // The reference is constructed against the document rather than by name alone.
                // A security requirement is serialised with the scheme's *name* as the object key,
                // which the reference can only supply if it can resolve itself — and without a host
                // document it cannot. The first version of this omitted the second argument and
                // produced `"security": [{}]`: an empty requirement that is valid OpenAPI, renders
                // without complaint, and says nothing. Found by reading the generated document.
                operation.Security =
                [
                    new OpenApiSecurityRequirement
                    {
                        [new OpenApiSecuritySchemeReference(SchemeName, context.Document)] = [],
                    },
                ];
            }

            return Task.CompletedTask;
        });

        return options;
    }
}
