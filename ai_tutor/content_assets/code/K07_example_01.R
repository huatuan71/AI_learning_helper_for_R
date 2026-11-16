f <- factor(c("low", "high", "mid"),
            levels = c("low", "mid", "high"),
            labels = c("Low", "Mid", "High"), ordered = TRUE)
print(f)
print(levels(f))
print(as.integer(f))
print(f > "Low")
