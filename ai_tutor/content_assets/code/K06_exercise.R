measurement <- c(20, 22, NA, Inf, 24, NaN, 26, -Inf, 28, 30)
keep <- is.finite(measurement)
clean <- measurement[keep]
print(c(total = length(measurement), kept = sum(keep), excluded = sum(!keep)))
print(clean)
print(mean(clean))
print(mean(c(NA_real_, NA_real_), na.rm = TRUE))
