# Profile: spring-boot

## 1. Scope

This profile details `AGENTS.md` §9 (Implementation rules) for Spring Boot: how it is used in a project. `AGENTS.md` sets the precedence: the constitution, policies, gates, workflows, and agents take precedence over this file. The project's code, configuration, and `docs/project.md` take precedence over the defaults in this profile (`AGENTS.md` §2, principle 10).

| Field | Value |
|-------|-------|
| Technology | Spring Boot — backend framework |
| Area in `docs/project.md` | Backend |

A statement that ends with the note *verify against the official release notes* in parentheses is not confirmed by the framework's sources: it needs checking against the technology's official release notes.

## 2. Applicability and detection

- Applies when `docs/project.md` lists `spring-boot` among the active profiles.
- Detected by the build file of the backend application: `pom.xml` for Maven, `build.gradle` for Gradle.
- The Gradle build file can also be `build.gradle.kts` (verify against the official release notes).
- In the default monorepo layout, the backend application is in `backend/`; `docs/project.md` records the actual layout.

## 3. Version policy

- This profile states no version. The versions of Spring Boot, Java, and the libraries this profile names, and the build tool — Maven or Gradle — come from `docs/project.md` and the build files.

## 4. Structure

- Application code is under `src/main/java/`; tests are under `src/test/java/`.
- Application configuration is under `src/main/resources/` (verify against the official release notes).

## 5. Conventions

- Language: Java.
- Default libraries: Spring Security, Bean Validation, JPA, and springdoc OpenAPI.

## 6. Testing

- Tests use JUnit with Spring test support, and Mockito where appropriate.
- A test carries the qualified AC ID in its display name: `@DisplayName("0007-AC2: rejects an expired reset token")`.

## 7. Verification commands

Defaults; `docs/project.md` overrides them.

| Build tool | Default command |
|------------|-----------------|
| Maven | `./mvnw verify` |
| Gradle | `./gradlew build` (verify against the official release notes) |
| Targeted, Maven | `./mvnw test -Dtest=<TestClass>` — only the test classes of the changed code (verify against the official release notes) |
| Targeted, Gradle | `./gradlew test --tests <TestClass>` (verify against the official release notes) |

## 8. Risk triggers

Stack-specific actions, each with the row of `.ai/policies/autonomy.md` §6 that it falls under. The levels are the policy's; this profile raises none.

| Action | Policy row | Level |
|--------|------------|:-----:|
| Changing Spring Security configuration | Security: Authentication, authorization, session handling, cryptography | L3 |

## 9. Review additions

Checks for a diff that touches this stack:

- Query shape: no N+1 queries.
- Every change to Spring Security configuration is named, with its policy row and level (§8).
