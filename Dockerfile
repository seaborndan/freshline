# The API as a container image.
#
# The build context is the repository root, not `src/Freshline.Api`, because the project does not
# build alone: it references Core and Infrastructure by project reference, and `Directory.Build.props`
# at the root is what promotes NuGet vulnerability advisories to build errors. Building from the
# project directory would silently drop that file and produce an image whose build had a weaker
# check than CI's.
#
#     docker build -t freshline-api .
#     docker run -p 8080:8080 -e "ConnectionStrings__Freshline=..." freshline-api
#
# Only the API is containerised. The ingestion worker runs on a schedule and is not part of the
# request path this milestone deploys; the front end is static files and goes to a static host.

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /source

# The manifests first, restore, then the sources. Restore is the slow step and depends only on these
# files, so a change to a `.cs` file reuses the cached restore layer instead of re-downloading every
# package. global.json is copied with them because it pins the SDK band — without it the image would
# build against whatever the base image happens to ship, which is the drift global.json exists to
# prevent.
COPY global.json Directory.Build.props ./
COPY src/Freshline.Core/Freshline.Core.csproj src/Freshline.Core/
COPY src/Freshline.Infrastructure/Freshline.Infrastructure.csproj src/Freshline.Infrastructure/
COPY src/Freshline.Api/Freshline.Api.csproj src/Freshline.Api/

# The API project rather than the solution, so the restore graph is the API's own — Core and
# Infrastructure, and nothing else. Restoring the solution would pull the test projects and the
# ingestion worker into an image that runs none of them, and would need their manifests in a build
# context that deliberately excludes `tests/`.
RUN dotnet restore src/Freshline.Api/Freshline.Api.csproj

COPY src/Freshline.Core/ src/Freshline.Core/
COPY src/Freshline.Infrastructure/ src/Freshline.Infrastructure/
COPY src/Freshline.Api/ src/Freshline.Api/

# --no-restore so a missing package is an error here rather than a second silent restore that hides
# a broken lock state — the same reasoning as the CI workflow.
RUN dotnet publish src/Freshline.Api/Freshline.Api.csproj \
    --configuration Release \
    --no-restore \
    --output /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app

# Non-root. The image defines this user; running as root would mean a process that only ever reads
# from a database and serves JSON has permission to rewrite its own filesystem.
USER $APP_UID

# 8080 rather than 80, because a non-root user cannot bind a privileged port. This is the aspnet
# image's own default; stated here so the port the ingress must target is visible in this file.
EXPOSE 8080
ENV ASPNETCORE_HTTP_PORTS=8080

COPY --from=build /app .

ENTRYPOINT ["dotnet", "Freshline.Api.dll"]
