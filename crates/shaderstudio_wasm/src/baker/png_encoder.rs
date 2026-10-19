/// Fast in-memory headless PNG encoder using the `png` crate.

pub fn encode_png_rgba(width: u32, height: u32, rgba_data: &[u8]) -> Result<Vec<u8>, String> {
    if (width * height * 4) as usize != rgba_data.len() {
        return Err(format!(
            "Buffer length {} does not match dimensions {}x{}x4",
            rgba_data.len(),
            width,
            height
        ));
    }

    let mut buf = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut buf, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgba_data).map_err(|e| e.to_string())?;
    }
    Ok(buf)
}
