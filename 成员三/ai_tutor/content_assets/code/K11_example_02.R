sales <- c(120, 80, 150, 90, 200, 60)
rate <- c(0.10, 0.08)
print(length(sales) %% length(rate) == 0)
commission <- sales * rate
print(commission)
print(sum(commission))
rate_full <- rep(c(0.10, 0.08), times = 3)
print(identical(commission, sales * rate_full))
