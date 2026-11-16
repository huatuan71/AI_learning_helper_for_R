q <- matrix(c(120, 135, 98, 110), nrow = 2,
            dimnames = list(c("North", "South"), c("Q1", "Q2")))
q <- rbind(q, West = c(105, 99))
q <- cbind(q, total = q[, "Q1"] + q[, "Q2"])
print(q)
print(t(q))
print(dim(t(q)))
