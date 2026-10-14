# R dependencies for export_whoneedsit.R and make_whoneedsit.R. Install with:  Rscript requirements.R
# Tested with R 4.3.3, httr2 1.0.0, jsonlite 1.8.8, httpuv 1.6.14 (httpuv is only for run_me.R). Needs R >= 4.1 (the scripts use the |> pipe).

pkgs <- c("pacman", "httr2", "jsonlite", "httpuv")
missing <- pkgs[!vapply(pkgs, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing)) install.packages(missing, repos = "https://cloud.r-project.org")
invisible(lapply(pkgs, function(p) cat(sprintf("%-9s %s\n", p, as.character(packageVersion(p))))))
