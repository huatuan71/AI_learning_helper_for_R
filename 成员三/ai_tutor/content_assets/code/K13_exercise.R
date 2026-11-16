w <- c(50.2, 49.8, 51.0, NA, 50.5, 49.9, 50.1, 52.4)
valid <- w[!is.na(w)]
res <- c(n = length(w), valid = length(valid), mean = mean(valid),
         median = median(valid), sd = sd(valid), min = min(valid), max = max(valid))
print(round(res, 2))
