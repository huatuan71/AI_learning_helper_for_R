temp <- array(c(20, 25, 22, 27, 21, 26, 23, 28,
                19, 24, 21, 25, 20, 26, 22, 27),
              dim = c(2, 4, 2),
              dimnames = list(c("Xian", "Wuhan"), paste0("d", 1:4), c("w1", "w2")))
print(apply(temp, 3, mean))
print(apply(temp, 1, mean))
print(apply(temp, c(1, 3), max))
