
# Libraries and Options ---------------------------------------------------
ifelse(!require(pacman), {install.packages("pacman"); require(pacman)}, require(pacman))

p_load(httr2, jsonlite)

# Variables ---------------------------------------------------------------
ACCOUNT_ID  <- Sys.getenv("CF_ACCOUNT_ID")   # required: set in the environment (never commit credentials)
API_TOKEN   <- Sys.getenv("CF_API_TOKEN")      # required (D1 read)
DATABASE_ID <- Sys.getenv("D1_DATABASE_ID", "82c55bae-2ae2-4502-bd8e-1a790ba981c4")  # whoneedsit
OUT         <- "atlas/data/whoneedsit_export.json"   # run from the repo root

# Extract Data ------------------------------------------------------------
read_sql <- function(name) paste(readLines(file.path("atlas", "sql", name), warn = FALSE, encoding = "UTF-8"), collapse = "\n")

# D1 response JSON text -> data.frame of the first statement's rows (JSON null -> NA)
parse_d1 <- function(body_text) {
  body <- fromJSON(body_text)
  if (!isTRUE(body$success)) stop("D1 query failed: ", paste(unlist(body$errors), collapse = " "))
  body$result$results[[1]]
}

d1_query <- function(sql) {
  resp <- request(sprintf("https://api.cloudflare.com/client/v4/accounts/%s/d1/database/%s/query", ACCOUNT_ID, DATABASE_ID)) |>
    req_auth_bearer_token(API_TOKEN) |>
    req_body_json(list(sql = sql)) |>
    req_timeout(60) |>
    req_perform()
  parse_d1(resp_body_string(resp, encoding = "UTF-8"))
}

if (sys.nframe() == 0L) {
  orgs           <- d1_query(read_sql("whoneedsit_orgs.sql"))
  people         <- d1_query(read_sql("whoneedsit_people.sql"))
  person_profile <- d1_query(read_sql("whoneedsit_person_profile.sql"))
  relationships  <- d1_query(read_sql("whoneedsit_relationships.sql"))
  if (!all(vapply(list(orgs, people, person_profile, relationships), is.data.frame, logical(1)))) stop("D1 returned no rows: check CF_ACCOUNT_ID, CF_API_TOKEN (needs D1 Read) and D1_DATABASE_ID")
  dir.create(dirname(OUT), showWarnings = FALSE, recursive = TRUE)
  write_json(list(orgs = orgs, people = people, person_profile = person_profile, relationships = relationships),
             OUT, auto_unbox = TRUE, na = "null", dataframe = "rows")
  cat(sprintf("%s: %d orgs, %d people (%d with an org), %d profiles, %d relationships\n", OUT, nrow(orgs), nrow(people),
              sum(!is.na(people$org)), nrow(person_profile), nrow(relationships)))
}
