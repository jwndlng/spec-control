## MODIFIED Requirements

### Requirement: Technology labels are detected from marker files

During every scan of a repository whose project folder exists, the dashboard SHALL derive detected labels from a
built-in rule table that maps the names of marker files and directories to labels. At least these rules SHALL exist:

| Marker | Label |
|---|---|
| a file ending in `.tf` | `terraform` |
| `go.mod` | `go` |
| `Cargo.toml` | `rust` |
| `package.json` | `javascript` |
| `tsconfig.json` | `typescript` |
| `pyproject.toml`, `requirements.txt`, `setup.py` or `Pipfile` | `python` |
| `Gemfile` | `ruby` |
| `pom.xml`, `build.gradle` or `build.gradle.kts` | `java` |
| a file ending in `.csproj` or `.sln` | `dotnet` |
| `composer.json` | `php` |
| `Package.swift` | `swift` |
| `Dockerfile`, `compose.yaml` or `docker-compose.yml` | `docker` |
| `Chart.yaml` | `helm` |
| `ansible.cfg` | `ansible` |

Detection SHALL look at the names of the entries of the project folder of the main checkout and of its immediate
subdirectories, and nothing deeper. It SHALL skip directories whose name starts with `.` and the directories
`node_modules`, `vendor`, `dist`, `build` and `target`, and the directories the framework module that reads the repository names as its own (`spec-frameworks`: "Framework file names and formats stay in the framework module"; for OpenSpec, `openspec`), SHALL read at most 64 subdirectories and at most 500
entries per directory, and SHALL NOT follow symbolic links. Detection MUST NOT open or read any file, MUST NOT run a
git command, MUST NOT write anything and MUST NOT contact a network. Matching SHALL be case-sensitive on file names.
Detected labels SHALL be part of the repository's snapshot, sorted by name and without duplicates, and SHALL change
with the next scan after the repository's files change. A repository whose scan fails SHALL have no detected labels.
A non-git folder SHALL be detected exactly like a git repository.

#### Scenario: Terraform repository
- **WHEN** `alpha-infra` has `main.tf` and `modules/network/` at its top level
- **THEN** its snapshot's detected labels are `["terraform"]`

#### Scenario: Marker in an immediate subdirectory
- **WHEN** `demo-ops` has `infra/main.tf` and `service/go.mod`
- **THEN** its detected labels are `["go", "terraform"]`

#### Scenario: Too deep
- **WHEN** a repository's only `.tf` file is `deploy/env/prod/main.tf`
- **THEN** `terraform` is not detected

#### Scenario: Dependency folders are skipped
- **WHEN** a repository has `package.json` and `node_modules/some-lib/Cargo.toml`
- **THEN** its detected labels are `["javascript"]`

#### Scenario: Detection follows the repository
- **WHEN** a `Dockerfile` is added to `beta-soc` and the next scan runs
- **THEN** `docker` is among `beta-soc`'s detected labels

#### Scenario: Read-only
- **WHEN** a scan detects labels in every fixture repository
- **THEN** every fixture repository is byte-for-byte unchanged and no git process was started for detection

#### Scenario: The framework's own tree is skipped
- **WHEN** `demo-ops`, read by the OpenSpec module, has `openspec/package.json` and nothing else that is a marker
- **THEN** its detected labels are empty, exactly as before the skipped name came from the module
