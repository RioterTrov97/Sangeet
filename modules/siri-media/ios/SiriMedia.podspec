Pod::Spec.new do |s|
  s.name           = 'SiriMedia'
  s.version        = '1.0.0'
  s.summary        = 'Siri media intents (INPlayMediaIntent) bridge and vocabulary donation'
  s.description    = 'Queues INPlayMediaIntent natively until JS is ready, then delivers it as an event.'
  s.author         = ''
  s.homepage       = 'https://github.com/'
  s.license        = 'MIT'
  s.platforms      = { :ios => '17.0' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '**/*.{h,m,swift}'
end
