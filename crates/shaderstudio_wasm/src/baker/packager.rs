use std::io::{Cursor, Write};
use zip::write::{SimpleFileOptions, ZipWriter};

/// Packages in-memory files into a valid PKZIP (.zip) archive using the `zip` crate.
pub fn create_zip_archive(files: &[(&str, &[u8])]) -> Result<Vec<u8>, String> {
    let mut cursor = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut cursor);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        for (name, data) in files {
            zip.start_file(*name, options).map_err(|e| e.to_string())?;
            zip.write_all(data).map_err(|e| e.to_string())?;
        }

        zip.finish().map_err(|e| e.to_string())?;
    }
    Ok(cursor.into_inner())
}
