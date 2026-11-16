scores <- c(55, 60, NA, 90, 100)
keep <- !is.na(scores) & scores >= 60 & scores < 90
print(keep)
print(scores[keep])
print(c(any = any(keep), all = all(keep)))
