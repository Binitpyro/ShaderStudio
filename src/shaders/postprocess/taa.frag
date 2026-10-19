#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform sampler2D u_historyTexture;
uniform sampler2D u_motionTexture;
uniform vec2 u_resolution;
uniform float u_feedbackMin;
uniform float u_feedbackMax;
uniform float u_motionScale;

in vec2 v_texCoord;
out vec4 fragColor;

vec3 RGBToYCoCg(vec3 rgb) {
  float Y  = dot(rgb, vec3( 0.25, 0.50,  0.25));
  float Co = dot(rgb, vec3( 0.50, 0.00, -0.50));
  float Cg = dot(rgb, vec3(-0.25, 0.50, -0.25));
  return vec3(Y, Co, Cg);
}

vec3 YCoCgToRGB(vec3 ycocg) {
  float Y  = ycocg.x;
  float Co = ycocg.y;
  float Cg = ycocg.z;
  float R = Y + Co - Cg;
  float G = Y + Cg;
  float B = Y - Co - Cg;
  return vec3(R, G, B);
}

void main() {
  vec2 texelSize = 1.0 / u_resolution;
  vec4 currentColor = texture(u_texture, v_texCoord);
  vec2 motion = texture(u_motionTexture, v_texCoord).xy * u_motionScale;
  vec2 historyUV = v_texCoord - motion;

  vec4 historyColor = texture(u_historyTexture, historyUV);

  vec3 minColor = RGBToYCoCg(currentColor.rgb);
  vec3 maxColor = minColor;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec3 neighbor = RGBToYCoCg(texture(u_texture, v_texCoord + vec2(float(x), float(y)) * texelSize).rgb);
      minColor = min(minColor, neighbor);
      maxColor = max(maxColor, neighbor);
    }
  }

  vec3 historyYCoCg = clamp(RGBToYCoCg(historyColor.rgb), minColor, maxColor);
  vec3 clampedHistory = YCoCgToRGB(historyYCoCg);

  float blendWeight = clamp(u_feedbackMax, 0.8, 0.98);
  if (!(historyUV.x >= 0.0 && historyUV.x <= 1.0 && historyUV.y >= 0.0 && historyUV.y <= 1.0)) {
    blendWeight = 0.0;
  }

  vec3 finalColor = mix(currentColor.rgb, clampedHistory, blendWeight);
  fragColor = vec4(finalColor, currentColor.a);
}
