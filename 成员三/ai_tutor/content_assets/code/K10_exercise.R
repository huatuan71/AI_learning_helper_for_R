temp <- c(D1 = 36.5, D2 = 37.2, D3 = NA, D4 = 41.8, D5 = 36.9, D6 = 35.1)
missing_pos <- which(is.na(temp))
abnormal_pos <- which(temp < 35.5 | temp > 40)
print(missing_pos)
print(abnormal_pos)
kept <- temp[-c(missing_pos, abnormal_pos)]
print(kept)
print(round(mean(kept), 2))
