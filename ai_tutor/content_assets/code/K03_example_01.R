mean_help <- utils::help("mean", package = "base")
print(length(mean_help) > 0L)
utils::example("mean", package = "base", echo = TRUE, ask = FALSE)
