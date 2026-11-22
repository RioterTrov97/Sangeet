Pod::Spec.new do |s|
  s.name           = 'SangeetRemote'
  s.version        = '1.0.0'
  s.summary        = 'Local-network TCP client and Bonjour browser for the Sangeet TV remote'
  s.description    = 'NWBrowser + NWConnection for the phone-as-remote protocol.'
  s.author         = ''
  s.homepage       = 'https://github.com/'
  s.license        = 'MIT'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,swift}'
end
