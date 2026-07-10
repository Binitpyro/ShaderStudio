#version 300 es

precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_blurAmount;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec2 texelSize = 1.0 / u_resolution * u_blurAmount;
  vec4 result = vec4(0.0);

  // Simple 9-tap gaussian blur
  float weights[9] = float[](
    0.0625, 0.125, 0.0625,
    0.125,  0.25,  0.125,
    0.0625, 0.125, 0.0625
  );

  int idx = 0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 offset = vec2(float(x), float(y)) * texelSize;
      result += texture(u_texture, v_texCoord + offset) * weights[idx];
      idx++;
    }
  }

  fragColor = result;
}
