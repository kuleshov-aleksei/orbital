package service

// pngMagic is the 8-byte PNG file signature, shared by the emoji and avatar
// upload type checks.
var pngMagic = []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
