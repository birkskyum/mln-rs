//! Native benchmark: `zlib-bench <corpus dir> [passes]`. Per group of blobs,
//! the median over passes of the time to decompress every blob once, and of
//! the time to compress every decompressed blob once (level 6).

use std::hint::black_box;
use std::time::Instant;

use zlib_bench::{BACKEND, compress, decompress, parse};

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(f64::total_cmp);
    let n = v.len();
    if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 }
}

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = args.next().expect("usage: zlib-bench <corpus dir> [passes]");
    let passes: usize = args.next().map_or(15, |p| p.parse().unwrap());
    let bin = std::fs::read(format!("{dir}/blobs.bin")).unwrap();
    let index = std::fs::read_to_string(format!("{dir}/index.txt")).unwrap();
    let blobs = parse(&bin, &index);

    let mut groups: Vec<String> = Vec::new();
    for b in &blobs {
        if !groups.contains(&b.group) {
            groups.push(b.group.clone());
        }
    }
    groups.push("all".to_string());

    println!("backend {BACKEND}, {passes} passes, {} blobs", blobs.len());
    println!(
        "| group | blobs | zlib KiB | raw KiB | inflate total ms | inflate µs/call | inflate MiB/s | deflate total ms | deflate µs/call | deflated KiB |"
    );
    println!("|---|---|---|---|---|---|---|---|---|---|");
    for group in &groups {
        let members: Vec<&[u8]> =
            blobs.iter().filter(|b| group == "all" || &b.group == group).map(|b| b.data.as_slice()).collect();
        let raws: Vec<Vec<u8>> = members.iter().map(|b| decompress(b).expect("decompress")).collect();
        let (zlib_len, raw_len): (usize, usize) =
            (members.iter().map(|b| b.len()).sum(), raws.iter().map(|r| r.len()).sum());
        let mut inflate = Vec::new();
        let mut deflate = Vec::new();
        let mut deflated = 0;
        for _ in 0..passes {
            let t = Instant::now();
            for b in &members {
                black_box(decompress(black_box(b)).unwrap());
            }
            inflate.push(t.elapsed().as_secs_f64() * 1e3);
            let t = Instant::now();
            deflated = 0;
            for r in &raws {
                deflated += black_box(compress(black_box(r)).unwrap()).len();
            }
            deflate.push(t.elapsed().as_secs_f64() * 1e3);
        }
        let (inflate, deflate) = (median(inflate), median(deflate));
        let n = members.len() as f64;
        println!(
            "| {group} | {} | {:.0} | {:.0} | {inflate:.2} | {:.1} | {:.0} | {deflate:.2} | {:.1} | {:.0} |",
            members.len(),
            zlib_len as f64 / 1024.0,
            raw_len as f64 / 1024.0,
            inflate * 1e3 / n,
            raw_len as f64 / 1048576.0 / (inflate / 1e3),
            deflate * 1e3 / n,
            deflated as f64 / 1024.0,
        );
    }
}
