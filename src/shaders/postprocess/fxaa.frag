#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_fxaaQualitySubpix;
uniform float u_fxaaQualityEdgeThreshold;
uniform float u_fxaaQualityEdgeThresholdMin;

in vec2 v_texCoord;
out vec4 fragColor;

float rgb2luma(vec3 rgb) {
  return dot(rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec2 inverseVP = 1.0 / u_resolution;
  vec3 rgbM = texture(u_texture, v_texCoord).rgb;

  float lumaM = rgb2luma(rgbM);
  float lumaNW = rgb2luma(texture(u_texture, v_texCoord + vec2(-1.0, -1.0) * inverseVP).rgb);
  float lumaNE = rgb2luma(texture(u_texture, v_texCoord + vec2( 1.0, -1.0) * inverseVP).rgb);
  float lumaSW = rgb2luma(texture(u_texture, v_texCoord + vec2(-1.0,  1.0) * inverseVP).rgb);
  float lumaSE = rgb2luma(texture(u_texture, v_texCoord + vec2( 1.0,  1.0) * inverseVP).rgb);

  float lumaMin = min(lumaM, min(min(lumaNW, lumaNE), min(lumaSW, lumaSE)));
  float lumaMax = max(lumaM, max(max(lumaNW, lumaNE), max(lumaSW, lumaSE)));
  float lumaRange = lumaMax - lumaMin;

  if (lumaRange < max(u_fxaaQualityEdgeThresholdMin, lumaMax * u_fxaaQualityEdgeThreshold)) {
    fragColor = vec4(rgbM, 1.0);
    return;
  }

  vec2 dir;
  dir.x = -((lumaNW + lumaNE) - (lumaSW + lumaSE));
  dir.y =  ((lumaNW + lumaSW) - (lumaNE + lumaSE));

  float dirReduce = max((lumaNW + lumaNE + lumaSW + lumaSE) * (0.25 * 0.125), 0.00001);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + dirReduce);
  dir = min(vec2(8.0), max(vec2(-8.0), dir * rcpDirMin)) * inverseVP;

  vec3 rgbA = 0.5 * (
    texture(u_texture, v_texCoord + dir * (1.0 / 3.0 - 0.5)).rgb +
    texture(u_texture, v_texCoord + dir * (2.0 / 3.0 - 0.5)).rgb
  );
  vec3 rgbB = rgbA * 0.5 + 0.25 * (
    texture(u_texture, v_texCoord + dir * (0.0 / 3.0 - 0.5)).rgb +
    texture(u_texture, v_texCoord + dir * (3.0 / 3.0 - 0.5)).rgb
  );

  float lumaB = rgb2luma(rgbB);
  if ((lumaB < lumaMin) || (lumaB > lumaMax)) {
    fragColor = vec4(rgbA, 1.0);
  } else {
    fragColor = vec4(rgbB, 1.0);
  }
}
