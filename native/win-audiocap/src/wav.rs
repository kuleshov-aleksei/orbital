//! Minimal PCM WAV writer for `capture --out`: a 44-byte header whose sizes
//! are patched when the capture stops.

use std::fs::File;
use std::io::{self, BufWriter, Seek, SeekFrom, Write};
use std::path::Path;

pub struct WavWriter {
    file: BufWriter<File>,
    data_bytes: u64,
}

/// RIFF sizes are 32-bit; stop growing the file before they overflow (~6 h).
const MAX_DATA_BYTES: u64 = u32::MAX as u64 - 36;

pub fn header(sample_rate: u32, channels: u16, bits: u16, data_bytes: u32) -> [u8; 44] {
    let block_align = channels * bits / 8;
    let byte_rate = sample_rate * block_align as u32;
    let mut h = [0u8; 44];
    h[0..4].copy_from_slice(b"RIFF");
    h[4..8].copy_from_slice(&(36u32.wrapping_add(data_bytes)).to_le_bytes());
    h[8..12].copy_from_slice(b"WAVE");
    h[12..16].copy_from_slice(b"fmt ");
    h[16..20].copy_from_slice(&16u32.to_le_bytes());
    h[20..22].copy_from_slice(&1u16.to_le_bytes()); // PCM
    h[22..24].copy_from_slice(&channels.to_le_bytes());
    h[24..28].copy_from_slice(&sample_rate.to_le_bytes());
    h[28..32].copy_from_slice(&byte_rate.to_le_bytes());
    h[32..34].copy_from_slice(&block_align.to_le_bytes());
    h[34..36].copy_from_slice(&bits.to_le_bytes());
    h[36..40].copy_from_slice(b"data");
    h[40..44].copy_from_slice(&data_bytes.to_le_bytes());
    h
}

impl WavWriter {
    pub fn create(path: &Path) -> io::Result<Self> {
        let mut file = BufWriter::new(File::create(path)?);
        file.write_all(&header(
            crate::loopback::SAMPLE_RATE,
            crate::loopback::CHANNELS,
            crate::loopback::BITS,
            0,
        ))?;
        Ok(Self { file, data_bytes: 0 })
    }

    pub fn write(&mut self, data: &[u8]) -> io::Result<()> {
        let room = MAX_DATA_BYTES.saturating_sub(self.data_bytes) as usize;
        let take = data.len().min(room);
        self.file.write_all(&data[..take])?;
        self.data_bytes += take as u64;
        Ok(())
    }

    /// Writes the final sizes into the header.
    pub fn finish(mut self) -> io::Result<()> {
        self.file.flush()?;
        let mut file = self.file.into_inner().map_err(|e| e.into_error())?;
        let data = self.data_bytes as u32;
        file.seek(SeekFrom::Start(4))?;
        file.write_all(&(36 + data).to_le_bytes())?;
        file.seek(SeekFrom::Start(40))?;
        file.write_all(&data.to_le_bytes())?;
        file.sync_all()
    }
}

#[cfg(test)]
mod tests {
    use super::header;

    #[test]
    fn header_layout() {
        let h = header(48000, 2, 16, 1000);
        assert_eq!(&h[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(h[4..8].try_into().unwrap()), 1036);
        assert_eq!(u16::from_le_bytes(h[22..24].try_into().unwrap()), 2);
        assert_eq!(u32::from_le_bytes(h[24..28].try_into().unwrap()), 48000);
        assert_eq!(u32::from_le_bytes(h[28..32].try_into().unwrap()), 192000);
        assert_eq!(u16::from_le_bytes(h[32..34].try_into().unwrap()), 4);
        assert_eq!(u32::from_le_bytes(h[40..44].try_into().unwrap()), 1000);
    }
}
