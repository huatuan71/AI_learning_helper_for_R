students <- sprintf("S%02d", 1:10)
set.seed(42)
picked <- students[sample(1:10, 3)]
print(picked)
set.seed(42)
again <- students[sample(1:10, 3)]
print(identical(picked, again))
print(length(unique(picked)))
