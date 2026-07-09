import 'package:flutter/material.dart';
import '../voice/voice_trigger.dart';
import 'sos_button.dart';

class SosPage extends StatefulWidget {
  const SosPage({super.key});

  @override
  State<SosPage> createState() => _SosPageState();
}

class _SosPageState extends State<SosPage> {
  final VoiceTrigger _voiceTrigger = VoiceTrigger();
  String _status = 'Monitoring';
  bool _alertSent = false;

  void _sendAlert(String source) {
    setState(() {
      _alertSent = true;
      _status = '$source alert sent';
    });
  }

  void _simulateVoice() {
    if (_voiceTrigger.matches('HELP HELP')) {
      _sendAlert('Voice');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('OPA Safety')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(_status, style: Theme.of(context).textTheme.headlineMedium),
              const SizedBox(height: 8),
              Text(
                _alertSent
                    ? 'Emergency contacts and responders are being notified.'
                    : 'Hold SOS or say HELP HELP to trigger an emergency incident.',
              ),
              const Spacer(),
              Center(child: SosButton(onTriggered: () => _sendAlert('SOS'))),
              const Spacer(),
              FilledButton.icon(
                onPressed: _simulateVoice,
                icon: const Icon(Icons.mic),
                label: const Text('Simulate HELP HELP'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}