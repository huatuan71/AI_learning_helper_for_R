print(requireNamespace("stats", quietly = TRUE))
library(stats)
print(stats::median(c(60, 80, 100)))
print("package:stats" %in% search())
