id <- c("Q01", "Q02", "Q03", "Q04", "Q05", "Q06", "Q07", "Q08", "Q09", "Q10")
age <- c(17, 18, 21, NA, 24, 30, 19, 22, 20, 18)
consent <- c(TRUE, TRUE, FALSE, TRUE, TRUE, TRUE, NA, TRUE, TRUE, TRUE)
score <- c(80, 60, 95, 70, NA, 88, 77, 90, 59, 100)
keep <- !is.na(age) & age >= 18 & age <= 25 &
  !is.na(consent) & consent & !is.na(score) & score >= 60
print(id[keep])
print(score[keep])
print(sum(keep))
