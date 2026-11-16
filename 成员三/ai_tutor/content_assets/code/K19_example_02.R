score <- matrix(c(78, 92, 65, 88, 95, 70), nrow = 3,
                dimnames = list(c("Ann", "Ben", "Cai"), c("mid", "final")))
print(score)
print(score["Ben", ])
one <- score["Ben", , drop = FALSE]
print(one)
print(dim(one))
high <- score[score[, "final"] >= 80, , drop = FALSE]
print(nrow(high))
