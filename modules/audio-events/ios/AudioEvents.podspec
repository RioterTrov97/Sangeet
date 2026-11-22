Pod::Spec.new do |s|
  s.name           = 'AudioEvents'
  s.version        = '1.0.0'
  s.summary        = 'Observes remote commands and audio interruptions without taking the handlers'
  s.description    = 'Additive MPRemoteCommandCenter targets plus AVAudioSession interruption notifications.'
  s.author         = ''
  s.homepage       = 'https://github.com/'
  s.license        = 'MIT'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,swift}'
end
