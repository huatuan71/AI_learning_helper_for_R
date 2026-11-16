# UTF-8 is needed for Chinese labels. This fallback supports Windows C locales.
if (!l10n_info()[["UTF-8"]]) {
  invisible(Sys.setlocale("LC_CTYPE", "English_United States.utf8"))
}
# Run from the code directory. An optional argument selects the output directory.
# Without an argument, the image is written into R's temporary directory.
args <- commandArgs(trailingOnly = TRUE)
output_dir <- if (length(args) > 0L) args[[1L]] else tempdir()
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)
svg_lines <- c(
  "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"720\" height=\"674\" viewBox=\"0 0 720 674\" role=\"img\" aria-labelledby=\"title desc\">",
  "<title id=\"title\">K02 安装、加载和显式调用</title>",
  "<desc id=\"desc\">分支关系图。安装先把包存入包库。随后可以用library附加包再按函数名调用，也可以用包名双冒号函数名直接调用导出函数。双冒号会按需加载命名空间。</desc>",
  "<defs><marker id=\"arrow\" markerWidth=\"10\" markerHeight=\"10\" refX=\"7\" refY=\"4\" orient=\"auto\"><path d=\"M0,0 L8,4 L0,8\" fill=\"none\" stroke=\"#79bdf1\" stroke-width=\"1.5\"/></marker></defs>",
  "<rect width=\"720\" height=\"674\" rx=\"20\" fill=\"#030813\"/>",
  "<g font-family=\"Microsoft YaHei, Noto Sans CJK SC, sans-serif\" fill=\"#b7c5d4\">",
  "<text x=\"36\" y=\"62\" font-size=\"32\" font-weight=\"700\" fill=\"#f5f9ff\">K02 安装、加载和显式调用</text>",
  "<rect x=\"36\" y=\"106\" width=\"648\" height=\"118\" rx=\"12\" fill=\"#0c1522\" stroke=\"#294158\" stroke-width=\"2\"/>",
  "<text x=\"58\" y=\"147\" font-size=\"30\" font-weight=\"700\" fill=\"#79bdf1\">安装到包库</text>",
  "<text x=\"58\" y=\"191\" font-size=\"27\" fill=\"#b7c5d4\">install.packages(&quot;包名&quot;)</text>",
  "<path d=\"M360,226 V245\" stroke=\"#79bdf1\" stroke-width=\"2\" marker-end=\"url(#arrow)\"/>",
  "<rect x=\"36\" y=\"254\" width=\"648\" height=\"118\" rx=\"12\" fill=\"#0c1522\" stroke=\"#294158\" stroke-width=\"2\"/>",
  "<text x=\"58\" y=\"295\" font-size=\"30\" font-weight=\"700\" fill=\"#79bdf1\">附加后按函数名调用</text>",
  "<text x=\"58\" y=\"339\" font-size=\"27\" fill=\"#b7c5d4\">library(包名)</text>",
  "<rect x=\"36\" y=\"402\" width=\"648\" height=\"118\" rx=\"12\" fill=\"#0c1522\" stroke=\"#294158\" stroke-width=\"2\"/>",
  "<text x=\"58\" y=\"443\" font-size=\"30\" font-weight=\"700\" fill=\"#79bdf1\">直接指定包调用</text>",
  "<text x=\"58\" y=\"487\" font-size=\"27\" fill=\"#b7c5d4\">stats::median(scores)</text>",
  "<path d=\"M360,239 H20 V461 H33\" fill=\"none\" stroke=\"#79bdf1\" stroke-width=\"2\" marker-end=\"url(#arrow)\"/>",
  "<text x=\"36\" y=\"609\" font-size=\"27\" fill=\"#9eafc2\">:: 调用会按需加载命名空间。</text>",
  "</g>",
  "</svg>"
)
output_file <- file.path(output_dir, "K02_visual_01.svg")
writeLines(enc2utf8(svg_lines), output_file, useBytes = TRUE)
cat("Generated K02_visual_01.svg\n")
