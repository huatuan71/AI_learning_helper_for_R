R <- matrix(c(0.010, -0.020,  0.015,
              0.005,  0.010, -0.010), nrow = 3,
            dimnames = list(c("Mon", "Tue", "Wed"), c("stock", "bond")))
w <- c(stock = 0.6, bond = 0.4)
port <- R %*% w
print(round(port, 4))
print(sum(w))
print(round(mean(port), 4))
