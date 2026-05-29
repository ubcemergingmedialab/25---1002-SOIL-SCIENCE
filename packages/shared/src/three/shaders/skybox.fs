uniform sampler2D map;
uniform float fadeStart;
uniform float fadeEnd;
varying vec3 vWorldDir;
const float PI = 3.141592653589793;

vec2 equirectUv(vec3 dir) {
  dir = normalize(dir);
  float u = atan(dir.z, dir.x) / (2.0 * PI) + 0.5;
  float v = asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5;
  return vec2(u, v);
}

void main() {
  vec3 dir = normalize(vWorldDir);
  float t = smoothstep(fadeStart, fadeEnd, dir.y); //return 0.0 when  dir.y <= fadeStart, 1.0 when dir.y >= fadeEnd, smooth in between
  vec3 sky = texture2D(map, equirectUv(dir)).rgb;
  gl_FragColor = vec4(mix(vec3(0.0), sky, t), 1.0);
}
