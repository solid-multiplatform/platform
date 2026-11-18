/* Offscreen rendering fixture. Protocol v1 emits an 8 x 8 RGBA checkerboard. */
#include <stdint.h>
#include <stdio.h>

int main(void) {
    uint8_t pixels[8 * 8 * 4];
    for (size_t y = 0; y < 8; ++y) {
        for (size_t x = 0; x < 8; ++x) {
            const size_t offset = 4 * (y * 8 + x);
            const uint8_t shade = (x + y) % 2 == 0 ? 32 : 224;
            pixels[offset] = shade;
            pixels[offset + 1] = shade;
            pixels[offset + 2] = shade;
            pixels[offset + 3] = 255;
        }
    }
    return fwrite(pixels, 1, sizeof(pixels), stdout) == sizeof(pixels) ? 0 : 1;
}
