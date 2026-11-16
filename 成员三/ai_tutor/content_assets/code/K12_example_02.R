roster <- c("Ann", "Ben", "Cai", "Dan")
grade_id <- c("Dan", "Ann", "Ben")
grade <- c(88, 92, 75)
pos <- match(roster, grade_id)
print(pos)
aligned <- grade[pos]
print(aligned)
print(roster[is.na(aligned)])
