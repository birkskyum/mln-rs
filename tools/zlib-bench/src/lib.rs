//! The corpus and the backend under test: mln_util's own compression
//! backends, compiled in by path, so the code measured is the code that ships.

#[cfg(feature = "libz-ffi")]
#[path = "../../../crates/mln_util/src/compression/libz.rs"]
mod backend;
#[cfg(not(feature = "libz-ffi"))]
#[path = "../../../crates/mln_util/src/compression/flate.rs"]
mod backend;

#[cfg(target_family = "wasm")]
#[path = "../../../crates/mln_util/src/compression/browser.rs"]
mod browser;

pub fn decompress(raw: &[u8]) -> Result<Vec<u8>, String> {
    backend::decompress(raw)
}

pub fn compress(raw: &[u8]) -> Result<Vec<u8>, String> {
    backend::compress(raw)
}

pub const BACKEND: &str = if cfg!(feature = "libz-ffi") {
    "libz-ffi"
} else if cfg!(feature = "libz-sys") {
    "libz-sys"
} else if cfg!(feature = "zlib-rs") {
    "zlib-rs"
} else {
    "miniz"
};

/// One compressed blob of the corpus.
pub struct Blob {
    pub group: String,
    pub data: std::rc::Rc<Vec<u8>>,
}

/// Parses `index.txt` (`group offset len` per line) over `blobs.bin`.
pub fn parse(bin: &[u8], index: &str) -> Vec<Blob> {
    index
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|line| {
            let mut parts = line.split_whitespace();
            let group = parts.next().unwrap().to_string();
            let offset: usize = parts.next().unwrap().parse().unwrap();
            let len: usize = parts.next().unwrap().parse().unwrap();
            Blob { group, data: std::rc::Rc::new(bin[offset..offset + len].to_vec()) }
        })
        .collect()
}

#[cfg(target_family = "wasm")]
mod web {
    use std::cell::RefCell;

    use wasm_bindgen::prelude::*;

    use super::*;

    thread_local! {
        static BLOBS: RefCell<Vec<Blob>> = const { RefCell::new(Vec::new()) };
    }

    fn blob(i: usize) -> std::rc::Rc<Vec<u8>> {
        BLOBS.with(|b| b.borrow()[i].data.clone())
    }

    #[wasm_bindgen]
    pub fn backend() -> String {
        BACKEND.to_string()
    }

    /// Loads the corpus into wasm memory, as tile data is before decompression.
    #[wasm_bindgen]
    pub fn load(bin: &[u8], index: &str) -> usize {
        BLOBS.with(|b| *b.borrow_mut() = parse(bin, index));
        BLOBS.with(|b| b.borrow().len())
    }

    #[wasm_bindgen]
    pub fn group(i: usize) -> String {
        BLOBS.with(|b| b.borrow()[i].group.clone())
    }

    /// The synchronous backend on blob `i`; the decompressed length.
    #[wasm_bindgen]
    pub fn inflate(i: usize) -> usize {
        decompress(&blob(i)).expect("decompress").len()
    }

    /// mln_util's `decompress_async` on wasm32: DecompressionStream, with the
    /// copies out of and back into wasm memory, falling back to the
    /// synchronous backend for streams the browser rejects.
    #[wasm_bindgen]
    pub async fn inflate_stream(i: usize) -> usize {
        let raw = blob(i);
        let out = match browser::decompress(&raw).await {
            Ok(data) => data,
            Err(_) => decompress(&raw).expect("decompress"),
        };
        out.len()
    }
}
