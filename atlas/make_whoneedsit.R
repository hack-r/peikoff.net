# Build docs/data/whoneedsit.json (viewer format) from the D1 export: orgs -> buildings, people -> figures.
# R port of make_whoneedsit.py (same mapping; R's random stream differs, so positions differ but ids/structure match).
#
#   Rscript atlas/make_whoneedsit.R [export.json] [out.json]      (run from the repo root)
#   (defaults: atlas/data/whoneedsit_export.json -> public/atlas/data/whoneedsit.json)
#
# Simplest mapping:
#   * every active org is a building; one floor per FLOOR_PEOPLE people (min 2 floors)
#   * orgs sit on a square grid: ARI (org 1) in the middle, the other big orgs as far from each other as possible,
#     the small ones fill in around the center
#   * a person stands on a random floor of their primary org's building; people with no org stand on the sidewalks
#   * primary org = org 1 (The Ayn Rand Institute) if the person has ANY relationship with it, else the export's pick;
#     every org a person is linked to is listed on their card ("All organizations")
#   * people linked to 2+ orgs get a walking route (building ids, primary first) in `routes`; the viewer animates it
#   * person id is "P<people.id>"; the click card shows EVERYTHING known about the person: every non-empty person_profile column
#     (bio, titles, names, dates, links, work counts...) plus a structured Relationships list built from the relationships table
#     (type, who/which org, direction, dates, confidence, evidence, source link). Older exports without those two tables still work.
# Needs: install.packages("jsonlite")

# Libraries and Options ---------------------------------------------------
ifelse(!require(pacman), {install.packages("pacman"); require(pacman)}, require(pacman))

p_load(httr2, jsonlite)

# Transform ---------------------------------------------------------------
FOOT <- 22; PITCH <- 36; FLOOR_H <- 3.5; FLOOR_PEOPLE <- 6; SEED <- 11

nz  <- function(x) !is.na(x) & nzchar(as.character(x))        # "present and non-empty"
chr <- function(x) ifelse(is.na(x), "", as.character(x))

# person_profile columns -> card labels. Unlisted columns are still shown (label = column name with spaces).
PROFILE_LABELS <- c(name = "Name", pen_name = "Pen name", birth_name = "Birth name", married_name = "Married name",
                    nicknames = "Nicknames", born = "Born", died = "Died", title = "Title", credentials = "Credentials",
                    affiliation = "Affiliation", bio = "Bio", major_works = "Major works",
                    articles_written = "Articles written", works_authored = "Works authored", works_edited = "Works edited",
                    works_other_role = "Works (other role)", first_work_year = "First work year", last_work_year = "Last work year",
                    url1 = "Link 1", url2 = "Link 2", url3 = "Link 3", image_url = "Image")
# derived group_concat() summaries of the relationships table: the structured Relationships list below carries the same facts
SKIP_PROFILE <- c("person_id", "organizations", "related_people")
PEIKOFF_ORGS <- c(121, 122, 120, 42)   # the Peikoffs' buildings, placed right around ARI: Don't Let It Go, Legalizing Privacy, Peikoff Library, Poso Press
PRIMARY_OVERRIDE <- c("139" = 121, "414" = 109)   # person id -> org id: Amy Peikoff stands in Don't Let It Go (her ARI link would otherwise win); H.R. McMaster in the Hoover Institution
ROUTES_ONLY <- list(`160` = c(8, 3, 108))   # person id -> org ids they walk between, instead of all their linked orgs (Carl Barney: Prometheus Foundation, OSI, The Objective Standard)
ROUTES_EXTRA <- list("4" = c(1, 121, 42))   # person id -> org ids they also walk to (Barbara Branden Peikoff: ARI, Don't Let It Go, Postsocialist Press), after their linked orgs
REGALIA <- list(`1` = c("crown", "hair", "face", "dress", "dollarpin", "holder"), `2` = "crown", `160` = c("jacket", "glasses", "bowtie", "book"))   # person id -> viewer accessories: crowns for Ayn Rand and Leonard Peikoff (Ayn Rand also gets her dark bob, black dress, dollar-sign brooch and cigarette holder); Carl Barney as a college professor. Kinds: crown, hair, face, dress, dollarpin, holder, jacket, glasses, bowtie, book, robe, staff
HIGHLIGHT <- list(name = "peikoff", ids = c(1, 4), color = "#ff2b2b", label = "Peikoffs, Ayn Rand, Barbara Branden Peikoff & their buildings")   # people whose name contains "name", person ids in "ids" (1 = Ayn Rand, 4 = Barbara Branden Peikoff), and PEIKOFF_ORGS are drawn red in the viewer
OUTSKIRTS <- list(`8` = c(-1, -1), `3` = c(-2, -2), `7` = c(-3, -2), `5` = c(-4, -3), `4` = c(-5, -3))   # org id -> lattice cell (i, j) outside the city grid, along the road to the lake: Prometheus Foundation, OSI, Anthem Foundation, Ayn Rand Society, Ayn Rand Centre UK (all have walkers)
NEXT_TO <- c("42" = 121)   # org id -> org id it must sit beside (Poso Press next to Don't Let It Go)
EXCLUDE_ORGS <- integer(0)   # exclusions are applied by NAME in atlas/decisions.json (atlas/apply_decisions.py), so a refresh that renumbers or reuses ids cannot drop the wrong org
DISPLAY_NAMES <- c("42" = "Postsocialist Press")   # org id -> name shown everywhere (the export calls it "Poso Press")
ALIASES <- c("42" = "Poso Press")   # org id -> other name found by search and shown on its card
BIG_MIN <- 5        # orgs with at least this many people are "big" for the spread-apart layout
PRIORITY_ORG <- 1   # The Ayn Rand Institute: anyone linked to it lives in its building
WEAK_ROLES <- c("TOS Author", "TOS Author (republished)", "OSI Blog Author", "Grantee")
SKIP_IF_ZERO <- c("articles_written", "works_authored", "works_edited", "works_other_role")

build_city <- function(orgs, people, profiles = NULL, relationships = NULL, seed = SEED, websites = NULL, groups = NULL, hair_people = NULL) {
  orgs <- orgs[!(orgs$id %in% EXCLUDE_ORGS), ]
  if (!is.null(relationships)) relationships <- relationships[!(relationships$org_id %in% EXCLUDE_ORGS) & !(relationships$related_org_id %in% EXCLUDE_ORGS), ]
  gone <- !is.na(people$org) & people$org %in% EXCLUDE_ORGS   # primary org removed -> street
  people$org[gone] <- NA
  orgs$short <- chr(orgs$short); orgs$category <- chr(orgs$category)
  dn <- unname(DISPLAY_NAMES[as.character(orgs$id)]); orgs$name <- ifelse(is.na(dn), orgs$name, dn)
  for (col in c("title", "role", "confidence")) people[[col]] <- chr(people[[col]])

  # person -> org links (relationships rows with both ids, org must become a building); org 1 wins as primary org
  links <- if (is.null(relationships)) NULL else {
    k <- relationships[!is.na(relationships$person_id) & !is.na(relationships$org_id) & relationships$org_id %in% orgs$id, ]
    k[order(k$id), ]
  }
  if (!is.null(links)) for (i in which(people$id %in% links$person_id)) {
    pr <- links[links$person_id == people$id[i] & links$org_id == PRIORITY_ORG, ]
    if (!nrow(pr)) next
    conf <- match(chr(pr$confidence), c("verified", "reported")); conf[is.na(conf)] <- 3L
    best <- pr[order(chr(pr$relationship_type) %in% WEAK_ROLES, conf, pr$id), ][1, ]
    people$org[i] <- PRIORITY_ORG; people$role[i] <- chr(best$relationship_type); people$confidence[i] <- chr(best$confidence)
  }

  # founder / CEO / president / chair of an org: that org is the primary building (best-verified one; ARI wins ties)
  LEADER_RE <- "\\b(co-?founder|founder|ceo|chief executive|president|executive director|chair(man|woman|person)?|owner)\\b"
  if (!is.null(links)) for (i in which(people$id %in% links$person_id)) {
    k <- links[links$person_id == people$id[i], ]
    rt <- chr(k$relationship_type)
    k <- k[grepl(LEADER_RE, rt, ignore.case = TRUE) & !grepl("\\bvice\\b", rt, ignore.case = TRUE), ]
    if (!nrow(k)) next
    conf <- match(chr(k$confidence), c("verified", "reported")); conf[is.na(conf)] <- 3L
    best <- k[order(conf, k$org_id != PRIORITY_ORG, k$id), ][1, ]
    people$org[i] <- best$org_id; people$role[i] <- chr(best$relationship_type); people$confidence[i] <- chr(best$confidence)
  }

  for (pid in names(PRIMARY_OVERRIDE)) {   # explicit per-person primary building
    i <- match(as.numeric(pid), people$id); want <- PRIMARY_OVERRIDE[[pid]]
    if (is.na(i) || !(want %in% orgs$id)) next
    k <- if (is.null(links)) NULL else links[links$person_id == people$id[i] & links$org_id == want, ]
    best <- NULL
    if (!is.null(k) && nrow(k)) {
      conf <- match(chr(k$confidence), c("verified", "reported")); conf[is.na(conf)] <- 3L
      best <- k[order(chr(k$relationship_type) %in% WEAK_ROLES, conf, k$id), ][1, ]
    }
    people$org[i] <- want
    people$role[i] <- if (is.null(best)) "" else chr(best$relationship_type)
    people$confidence[i] <- if (is.null(best)) "" else chr(best$confidence)
  }

  # people per org -> order buildings: most people first, ties by org id
  orgs$n <- vapply(orgs$id, function(id) sum(people$org == id, na.rm = TRUE), numeric(1))
  orgs <- orgs[order(-orgs$n, orgs$id), ]
  N <- nrow(orgs)

  outs  <- OUTSKIRTS[names(OUTSKIRTS) %in% as.character(orgs$id)]
  side  <- ceiling(sqrt(N - length(outs)))
  mid   <- (side - 1) / 2
  free  <- expand.grid(i = 0:(side - 1), j = 0:(side - 1))
  free$d <- sqrt((free$i - mid)^2 + (free$j - mid)^2)
  free  <- free[order(free$d, free$i, free$j), c("i", "j")]
  extent <- side * PITCH

  # layout: the priority org (ARI) sits in the center; the other big orgs (>= BIG_MIN people) are spread as far apart as
  # possible (greedy farthest-point); everything else fills the remaining cells from the center outwards, biggest first
  take <- function(k) { cell <- free[k, ]; free <<- free[-k, ]; cell }
  cell_i <- cell_j <- integer(N); placed <- logical(N); big <- matrix(numeric(0), ncol = 2)
  place <- function(o, cell) { cell_i[o] <<- cell$i; cell_j[o] <<- cell$j; placed[o] <<- TRUE }
  for (oid in names(outs)) place(match(as.numeric(oid), orgs$id), data.frame(i = outs[[oid]][1], j = outs[[oid]][2]))   # outskirts: fixed cells off the grid
  pri <- match(PRIORITY_ORG, orgs$id)
  if (!is.na(pri)) { cell <- take(1L); place(pri, cell); big <- rbind(big, c(cell$i, cell$j)) }
  for (o in seq_len(N)) {
    if (placed[o] || orgs$n[o] < BIG_MIN) next
    score <- vapply(seq_len(nrow(free)), function(k) {
      if (!nrow(big)) 0 else round(min(sqrt((free$i[k] - big[, 1])^2 + (free$j[k] - big[, 2])^2)), 9) }, numeric(1))
    cand <- which(score == max(score))
    k <- cand[order(-free$i[cand], -free$j[cand], decreasing = TRUE)][1]   # ties: lowest i, then lowest j (as in Python)
    cell <- take(k); place(o, cell); big <- rbind(big, c(cell$i, cell$j))
  }
  # the Peikoffs' buildings: free cells touching ARI's cell (3x3 block), nearest first; a NEXT_TO partner goes beside its anchor
  if (!is.na(pri)) {
    ai <- cell_i[pri]; aj <- cell_j[pri]
    for (oid in PEIKOFF_ORGS) {
      o <- match(oid, orgs$id)
      if (is.na(o) || placed[o]) next
      cand <- which(pmax(abs(free$i - ai), abs(free$j - aj)) == 1)
      if (!length(cand)) break
      ao <- match(unname(NEXT_TO[as.character(oid)]), orgs$id)
      da <- if (!is.na(ao) && placed[ao]) round(sqrt((free$i[cand] - cell_i[ao])^2 + (free$j[cand] - cell_j[ao])^2), 9) else rep(0, length(cand))
      dr <- round(sqrt((free$i[cand] - ai)^2 + (free$j[cand] - aj)^2), 9)
      k <- cand[order(da, dr, free$i[cand], free$j[cand])][1]
      place(o, take(k))
    }
  }

  # NEXT_TO: the follower org takes the free cell nearest to its anchor's cell
  follow_of <- function(anchor_id) { f <- names(NEXT_TO)[NEXT_TO == anchor_id]; if (length(f)) match(as.numeric(f[1]), orgs$id) else NA_integer_ }
  is_follower <- !is.na(match(orgs$id, as.numeric(names(NEXT_TO)))) & !is.na(match(NEXT_TO[as.character(orgs$id)], orgs$id))
  beside <- function(o, f) {
    d <- round(sqrt((free$i - cell_i[o])^2 + (free$j - cell_j[o])^2), 9)
    cand <- which(d == min(d)); k <- cand[order(free$i[cand], free$j[cand])][1]
    place(f, take(k))
  }
  for (o in seq_len(N)) {
    if (placed[o] || is_follower[o]) next
    place(o, take(1L))
    f <- follow_of(orgs$id[o]); if (!is.na(f) && !placed[f]) beside(o, f)
  }
  for (o in seq_len(N)) { f <- follow_of(orgs$id[o]); if (!is.na(f) && !placed[f]) beside(o, f) }   # anchors that were big orgs
  for (o in seq_len(N)) if (!placed[o]) place(o, take(1L))

  cx <- (cell_i + .5) * PITCH; cy <- (cell_j + .5) * PITCH
  floors <- pmax(2L, as.integer(ceiling(orgs$n / FLOOR_PEOPLE)))
  buildings <- data.frame(
    id = seq_len(N) - 1L, org_id = orgs$id, name = orgs$name, short = orgs$short, alias = chr(unname(ALIASES[as.character(orgs$id)])), category = orgs$category,
    x0 = round(cx - FOOT / 2, 2), y0 = round(cy - FOOT / 2, 2), x1 = round(cx + FOOT / 2, 2), y1 = round(cy + FOOT / 2, 2),
    floors = floors, h = round(floors * FLOOR_H, 2), stringsAsFactors = FALSE)
  buildings$urls <- lapply(seq_len(N), function(k) I(as.character(unlist(orgs$urls[[k]]))))   # live links for the building card (I() keeps one link an array)
  bld_of_org <- setNames(buildings$id, as.character(buildings$org_id))

  # name lookups for the Relationships list
  org_name    <- setNames(as.character(orgs$name), as.character(orgs$id))
  person_name <- setNames(as.character(people$name), as.character(people$id))
  if (!is.null(profiles)) {
    extra <- profiles[!(as.character(profiles$person_id) %in% names(person_name)), ]
    person_name <- c(person_name, setNames(as.character(extra$name), as.character(extra$person_id)))
  }
  label_person <- function(id) { v <- unname(person_name[as.character(id)]); if (is.na(v)) paste0("person #", id) else v }
  label_org    <- function(id) { v <- unname(org_name[as.character(id)]);    if (is.na(v)) paste0("org #", id)    else v }

  # "Org (role / role); Org (role)..." for every org the person is linked to, primary building first
  org_list <- function(p) {
    k <- if (is.null(links)) NULL else links[links$person_id == p$id, ]
    if (is.null(k) || !nrow(k)) return("")
    k <- k[order(k$org_id != p$org, k$id), ]
    parts <- vapply(unique(k$org_id), function(o) {
      rl <- unique(chr(k$relationship_type[k$org_id == o])); rl <- rl[nzchar(rl)]
      paste0(org_name[[as.character(o)]], if (length(rl)) paste0(" (", paste(rl, collapse = " / "), ")") else "")
    }, character(1))
    paste(parts, collapse = "; ")
  }

  # every relationships row that involves this person, as a list of records (direction: out = person is the subject)
  rel_records <- function(pid) {
    if (is.null(relationships)) return(NULL)
    idx <- which(relationships$person_id == pid | relationships$related_person_id == pid)
    idx <- idx[order(relationships$id[idx])]
    lapply(idx, function(i) {
      r   <- relationships[i, ]
      out <- !is.na(r$person_id) && r$person_id == pid
      with <- if (out) {
        if (!is.na(r$related_person_id)) label_person(r$related_person_id)
        else if (!is.na(r$org_id)) label_org(r$org_id)
        else if (!is.na(r$related_org_id)) label_org(r$related_org_id) else ""
      } else {
        if (!is.na(r$person_id)) label_person(r$person_id)
        else if (!is.na(r$org_id)) label_org(r$org_id) else ""
      }
      rec <- list(type = chr(r$relationship_type), dir = if (out) "out" else "in", with = with)
      for (f in c("start_date", "end_date", "evidence", "source_url"))   # confidence labels (verified, reported, ...) never go on a card, nor do machine-written bylines
        if (nz(r[[f]]) && !(f == "evidence" && grepl("^Byline on [0-9]+ .*article\\(s\\) in D1", as.character(r[[f]])))) rec[[f]] <- as.character(r[[f]])
      rec
    })
  }

  set.seed(seed)
  P <- nrow(people)
  xs <- ys <- zs <- hd <- numeric(P); kind <- bid <- integer(P)
  meta <- vector("list", P)
  for (r in seq_len(P)) {
    p  <- people[r, ]
    bk <- if (!is.na(p$org)) unname(bld_of_org[as.character(p$org)]) else NA_integer_
    if (!is.na(bk)) {                                    # inside a building
      b <- buildings[bk + 1L, ]
      xs[r] <- runif(1, b$x0 + 1, b$x1 - 1); ys[r] <- runif(1, b$y0 + 1, b$y1 - 1)
      zs[r] <- (sample.int(b$floors, 1L) - 1L) * FLOOR_H; kind[r] <- 1L; bid[r] <- bk
    } else {                                             # sidewalk: street centerline on a cell boundary, 3 m to either side
      line  <- sample(0:side, 1L) * PITCH + sample(c(-3, 3), 1L)
      along <- runif(1, 0, extent)
      if (runif(1) < .5) { xs[r] <- along; ys[r] <- line } else { xs[r] <- line; ys[r] <- along }
      zs[r] <- 0; kind[r] <- 0L; bid[r] <- -1L
    }
    hd[r] <- runif(1, 0, 360)
    pi   <- if (is.null(profiles)) NA_integer_ else match(p$id, profiles$person_id)
    prof <- if (is.na(pi)) NULL else profiles[pi, ]
    m <- list(Name = if (!is.null(prof) && nz(prof$name)) as.character(prof$name) else p$name)
    if (!is.na(bk)) m$Organization <- buildings$name[bk + 1L]
    ol <- org_list(p)
    if (nzchar(ol)) m[["All organizations"]] <- ol
    if (nz(p$role)) m[["Role at org"]] <- p$role
    if (!is.null(prof)) {                                # every non-empty profile column
      u <- c(prof$url1, prof$url2, prof$url3); u <- u[!is.na(u) & nzchar(u)]
      u <- u[order(grepl("wikipedia.org", u, ignore.case = TRUE))]   # stable: non-Wikipedia links first, Wikipedia last
      for (j in 1:3) if (paste0("url", j) %in% names(prof)) prof[[paste0("url", j)]] <- if (j <= length(u)) u[j] else NA_character_
      for (col in setdiff(names(prof), c("name", SKIP_PROFILE))) {
        v <- prof[[col]]
        if (length(v) != 1 || !nz(v)) next
        if (col %in% SKIP_IF_ZERO && isTRUE(suppressWarnings(as.numeric(v)) == 0)) next
        label <- if (col %in% names(PROFILE_LABELS)) PROFILE_LABELS[[col]] else gsub("_", " ", col)
        m[[label]] <- as.character(v)
      }
    } else {                                             # old export without person_profile
      if (nz(p$title)) m$Title <- p$title
      if (!is.na(p$born)) m$Born <- as.character(p$born)
      if (nz(p$died))  m$Died <- as.character(p$died)
    }
    recs <- rel_records(p$id)
    if (length(recs)) m$Relationships <- recs
    meta[[r]] <- m
  }
  ids <- paste0("P", people$id)
  names(meta) <- ids
  out_people <- lapply(seq_len(P), function(r) c(round(xs[r], 2), round(ys[r], 2), round(zs[r], 2), kind[r], round(hd[r], 1), bid[r]))
  bcounts <- vapply(buildings$id, function(k) sum(bid == k), numeric(1))

  # walking routes: people linked to 2+ different orgs walk between those buildings (primary first, then link order)
  routes <- list()
  for (i in seq_len(P)) {
    b <- integer(0)
    only <- ROUTES_ONLY[[as.character(people$id[i])]]
    if (!is.null(only)) b <- unique(unname(bld_of_org[as.character(only)]))
    else if (!is.null(links)) {
      k <- links[links$person_id == people$id[i], ]
      if (nrow(k)) { k <- k[order(k$org_id != people$org[i], k$id), ]; b <- unique(unname(bld_of_org[as.character(k$org_id)])) }
    }
    ex <- unname(bld_of_org[as.character(ROUTES_EXTRA[[as.character(people$id[i])]])])
    b <- unique(c(b, ex)); b <- b[!is.na(b)]
    if (length(b) >= 2) routes[[ids[i]]] <- as.integer(b)
  }

  if (!is.null(websites)) websites <- websites[!(websites$org_id %in% EXCLUDE_ORGS), ]   # sites of dropped orgs are dropped too
  list(floor_h = FLOOR_H, extent = extent, buildings = buildings, websites = websites, groups = if (is.null(groups)) list() else groups, people = out_people, ids = ids,
       counts = setNames(as.list(bcounts), as.character(buildings$id)), meta = meta, routes = routes,
       regalia = { r <- REGALIA; names(r) <- paste0("P", names(r)); lapply(r[names(r) %in% ids], I) },
       hair = I({ h <- paste0("P", setdiff(as.integer(unlist(hair_people)), as.integer(names(REGALIA)))); h[h %in% ids] }),
       highlight = list(color = HIGHLIGHT$color, label = HIGHLIGHT$label,
                        people = I(ids[grepl(HIGHLIGHT$name, tolower(vapply(meta, function(m) as.character(m$Name), "")), fixed = TRUE) | ids %in% paste0("P", HIGHLIGHT$ids)]),
                        buildings = I(as.integer({ b <- unname(bld_of_org[as.character(PEIKOFF_ORGS)]); b[!is.na(b)] }))))
}

if (sys.nframe() == 0L) {
  args <- commandArgs(trailingOnly = TRUE)
  src  <- if (length(args) >= 1) args[1] else "atlas/data/whoneedsit_export.json"
  out  <- if (length(args) >= 2) args[2] else "public/atlas/data/whoneedsit.json"
  # editorial decisions (exclusions, merges, text scrub, website rules, drift guard) live in atlas/decisions.json and are applied by one
  # shared step, atlas/apply_decisions.py, so the R and Python makers cannot disagree
  script_dir <- dirname(sub("^--file=", "", grep("^--file=", commandArgs(FALSE), value = TRUE)[1]))
  decided <- tempfile(fileext = ".json")
  status <- system2("python3", c(file.path(script_dir, "apply_decisions.py"), shQuote(src), shQuote(decided)))
  if (status != 0) stop("apply_decisions.py failed (exit ", status, "); see the DECISION DRIFT message above")
  d    <- fromJSON(decided)
  city <- build_city(d$orgs, d$people, d$person_profile, d$relationships, websites = d$websites, groups = d$groups, hair_people = d$hair_people)
  write_json(city, out, auto_unbox = TRUE, na = "null", dataframe = "rows", digits = NA)
  n_in <- sum(unlist(city$counts))
  cat(sprintf("%s: %d buildings (orgs), %d people (%d in buildings, %d on the street)\n",
              out, nrow(city$buildings), length(city$people), n_in, length(city$people) - n_in))
}
