measurement <- c(12, 13, NA, 14, Inf, 15, NaN, 16, -Inf, 17, 18, 19)
keep <- is.finite(measurement)
print(c(total = length(measurement), missing = sum(is.na(measurement)),
        nan = sum(is.nan(measurement)), infinite = sum(is.infinite(measurement)),
        finite = sum(keep)))
print(mean(measurement, na.rm = TRUE))
print(measurement[keep])
print(mean(measurement[keep]))
