id <- c("S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10")
scores <- c(59, 60, 90, 91, NA, 80, 100, 0, 60, 90)
attended <- c(TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, TRUE, TRUE, NA, TRUE)
keep <- !is.na(scores) & scores >= 60 & scores <= 90 &
  !is.na(attended) & attended
print(id[keep])
print(scores[keep])
print(sum(keep))
