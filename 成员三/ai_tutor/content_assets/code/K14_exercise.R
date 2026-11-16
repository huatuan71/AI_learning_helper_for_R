runner <- c("R1", "R2", "R3", "R4", "R5", "R6")
time <- c(12.8, 11.9, NA, 12.8, 13.5, 11.9)
o <- order(time)
print(runner[o])
place <- rank(time, ties.method = "min", na.last = "keep")
names(place) <- runner
print(place)
print(sort(time))
