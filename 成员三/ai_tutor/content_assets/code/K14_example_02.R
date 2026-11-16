name <- c("Ann", "Ben", "Cai", "Dan", "Eva")
score <- c(78, 92, 65, 92, 88)
o <- order(score, decreasing = TRUE)
print(name[o])
print(score[o])
place <- rank(-score, ties.method = "min")
names(place) <- name
print(place)
