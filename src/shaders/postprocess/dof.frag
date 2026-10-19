#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform sampler2D u_depthTexture;
uniform vec2 u_resolution;
uniform float u_focalDistance;
uniform float u_aperture;
uniform float u_maxBlur;
uniform float u_bokehShape; // 0: circle, 1: hexagon, 2: octagon

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 centerColor = texture(u_texture, v_texCoord);
  float depth = texture(u_depthTexture, v_texCoord).r;

  float near = 0.1;
  float far = 100.0;
  float zLinear = (near * far) / (far - depth * (far - near));

  float coc = clamp(abs(zLinear - u_focalDistance) / max(zLinear, 0.001) * u_aperture * 100.0, 0.0, u_maxBlur);

  if (coc < 0.5) {
    fragColor = centerColor;
    return;
  }

  vec4 accum = vec4(0.0);
  float totalWeight = 0.0;
  const int SAMPLES = 24;
  vec2 texelSize = 1.0 / u_resolution;

  for (int i = 0; i < SAMPLES; i++) {
    float theta = float(i) * 2.3999632;
    float r = sqrt(float(i + 1) / float(SAMPLES)) * coc;

    if (u_bokehShape > 0.5) {
      float n = u_bokehShape > 1.5 ? 8.0 : 6.0;
      float piN = 3.14159265 / n;
      float modAngle = mod(theta, 2.0 * piN) - piN;
      r *= cos(piN) / cos(modAngle);
    }

    vec2 offset = vec2(cos(theta), sin(theta)) * r * texelSize;
    vec4 sampleCol = texture(u_texture, v_texCoord + offset);

    float lum = dot(sampleCol.rgb, vec3(0.299, 0.587, 0.114));
    float weight = 1.0 + pow(max(0.0, lum - 0.7), 2.0) * 4.0;

    accum += sampleCol * weight;
    totalWeight += weight;
  }

  fragColor = accum / max(totalWeight, 0.001);
}
