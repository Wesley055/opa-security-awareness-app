import 'package:flutter/material.dart';

class SosButton extends StatefulWidget {
  const SosButton({required this.onTriggered, super.key});

  final VoidCallback onTriggered;

  @override
  State<SosButton> createState() => _SosButtonState();
}

class _SosButtonState extends State<SosButton> {
  bool _pressed = false;

  void _trigger() {
    setState(() => _pressed = false);
    widget.onTriggered();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onLongPressStart: (_) => setState(() => _pressed = true),
      onLongPressEnd: (_) => _trigger(),
      child: AnimatedScale(
        scale: _pressed ? 0.96 : 1,
        duration: const Duration(milliseconds: 120),
        child: Semantics(
          button: true,
          label: 'Hold to send SOS emergency alert',
          child: Container(
            width: 208,
            height: 208,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(colors: [Color(0xFFFF6868), Color(0xFFC81E1E)]),
            ),
            alignment: Alignment.center,
            child: const Text(
              'SOS',
              style: TextStyle(color: Colors.white, fontSize: 52, fontWeight: FontWeight.w900),
            ),
          ),
        ),
      ),
    );
  }
}